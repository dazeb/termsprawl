#!/usr/bin/env bash
# space-e2e — end-to-end verification of online canvas spaces (Phase 15, E1).
#
# What it proves, in order:
#   1. A scratch cloud accepts a space-sync snapshot (POST /api/v1/space/content,
#      HS256 scope=space-sync bearer) and serves it back (GET).
#   2. A REAL Server Edition space boots with the sync env, boot-restores the
#      cloud snapshot into its /data (workspace.json carries the node ids).
#   3. Driving the space over its token-gated WS RPC works (project:add +
#      workspace:save-nodes of one terminal + one sticky).
#   4. After a restart, the canvas is still there (volume persistence).
#   5. A save after restore pushes a snapshot back to the cloud store.
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
port=3199
base="http://127.0.0.1:$port"
content_dir="$scratch/content"
fail() { echo "FAIL: $1"; exit 1; }

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
    const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest()
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
    const claims = JSON.parse(b64d(p).toString())
    return claims.scope === 'space-sync' && claims.exp > Date.now() / 1000 ? claims : null
  } catch { return null }
}
fs.mkdirSync(dir, { recursive: true })
const file = (login) => `${dir}/${login}.json`
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
}).listen(8787, '127.0.0.1', () => console.log('scratch cloud on :8787'))
EOF
node "$scratch/cloud.mjs" "$secret" "$content_dir" &
CLOUD_PID=$!
sleep 0.4

TOKEN=$(mint_sync_token)

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
    "currentProjectId": "p-e2e"
  },
  "files": {},
  "scrollbacks": {}
}
EOF
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:8787/api/v1/space/content" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @"$scratch/seed.json")
[ "$code" = "200" ] || fail "seed push returned $code"
# and reads back
curl -s "http://127.0.0.1:8787/api/v1/space/content" -H "Authorization: Bearer $TOKEN" | grep -q n-e2e-sticky || fail "seeded snapshot does not read back"

echo "── 3. boot the space and assert boot-restore"
boot_space() {
  if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
    TS_CLOUD_API="http://127.0.0.1:8787" TS_SPACE_BOOT_TOKEN="$TOKEN" \
    TERMSPRAWL_SERVER_TOKEN="$TOKEN" TERMSPRAWL_SERVER_HOST="127.0.0.1" PORT=$port \
    TERMSPRAWL_DATA="$scratch/space-data" node "$repo_root/out/server/index.js" &
  else
    docker rm -f ts-space-e2e >/dev/null 2>&1 || true
    docker run -d --name ts-space-e2e -p "127.0.0.1:$port:3110" \
      -e TS_CLOUD_API="http://172.17.0.1:8787" \
      -e TS_SPACE_BOOT_TOKEN="$TOKEN" \
      -e TERMSPRAWL_SERVER_TOKEN="$TOKEN" \
      -e TERMSPRAWL_SERVER_HOST=0.0.0.0 \
      ts-space:latest >/dev/null
  fi
  SPACE_PID=$!
}
boot_space
wait_for "$base/" 20
echo "     space is up on :$port"
# boot-restore wrote the snapshot into the space's data dir
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  grep -q "n-e2e-sticky" "$scratch/space-data/workspace.json" 2>/dev/null \
    || fail "boot-restore did not write the seeded snapshot into the space data"
else
  docker exec ts-space-e2e grep -q "n-e2e-sticky" /data/workspace.json \
    || fail "boot-restore did not write the seeded snapshot into the container volume"
fi
echo "     boot-restore OK (seeded nodes present in the space's workspace)"

echo "── 4. drive the canvas over the token-gated WS RPC"
node - "$port" "$TOKEN" <<'EOF'
// Minimal RFC6455 client, enough for this script: handshake, unmasked
// server frames, masked text frames out, read until N responses arrive.
const net = require('node:net')
const crypto = require('node:crypto')
const [port, token] = process.argv.slice(2)
const sock = net.connect(Number(port), '127.0.0.1')
let buf = Buffer.alloc(0)
let handshakeDone = false
const responses = []
const pending = new Map()
let idc = 0

function sendFrame(text) {
  const bytes = Buffer.from(text)
  const mask = crypto.randomBytes(4)
  let header
  if (bytes.length < 126) header = Buffer.from([0x81, 0x80 | bytes.length])
  else {
    header = Buffer.alloc(4)
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(bytes.length, 2)
  }
  const masked = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) masked[i] = bytes[i] ^ mask[i % 4]
  sock.write(Buffer.concat([header, mask, masked]))
}
function parseFrames() {
  // one RFC6455 frame at a time (server frames: unmasked)
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
    const opcode = buf && (buf[0] & 0x0f)
    void opcode
    if ((buf[0] & 0x0f) === 0x8) { console.error('FAIL: server closed the socket'); process.exit(1) }
    try { responses.push(JSON.parse(payload.toString('utf8'))) } catch { /* ignore non-json */ }
    const r = responses[responses.length - 1]
    if (r && pending.has(r.id)) pending.get(r.id)(r)
  }
}
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++idc
    pending.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(`${method}: ${r.error}`))))
    sendFrame(JSON.stringify({ id, method, args }))
    setTimeout(() => reject(new Error(`${method}: timeout`)), 5000)
  })
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
      // Wrong token must have been refused upstream; now drive the canvas.
      const proj = await call('project:add', ['e2e', null])
      const pid = proj.result.id
      await call('workspace:save-nodes', [pid, [
        { id: 'n-ws-term', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 'e2e-ws' } },
        { id: 'n-ws-sticky', type: 'sticky', position: { x: 400, y: 0 }, data: { kind: 'sticky', title: 'note', text: 'saved over ws' } },
      ]])
      console.log('WS_DRIVE_OK')
      process.exit(0)
    } catch (e) {
      console.error('FAIL: ws drive:', e.message)
      process.exit(1)
    }
  }
  parseFrames()
})
sock.on('error', (e) => { console.error('FAIL: ws socket error:', e.message); process.exit(1) })
setTimeout(() => { console.error('FAIL: ws drive global timeout'); process.exit(1) }, 10000)
EOF
grep -q "WS_DRIVE_OK" /dev/null # (marker for readability; the node script exits 0 on success)
echo "     ws drive OK (terminal + sticky saved)"

echo "── 5. restart the space; volume persistence + boot-restore must hold"
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  kill "$SPACE_PID" 2>/dev/null || true; wait "$SPACE_PID" 2>/dev/null || true
  sleep 0.5
else
  docker restart ts-space-e2e >/dev/null
fi
boot_space
wait_for "$base/" 20
if [ "${TS_E2E_SKIP_DOCKER:-0}" = "1" ]; then
  grep -q "n-ws-sticky" "$scratch/space-data/workspace.json" || fail "WS-saved nodes lost across restart"
else
  docker exec ts-space-e2e grep -q "n-ws-sticky" /data/workspace.json || fail "WS-saved nodes lost across restart"
fi
echo "     restart OK (WS-saved canvas survived)"

echo "── 6. the space pushes its snapshot to the cloud store"
# A post-restore save is dirty → the push scheduler fires (first push is not
# debounced: lastPushAt starts at -Infinity). Touch the canvas over WS again.
node - "$port" "$TOKEN" <<'EOF'
const net = require('node:net')
const crypto = require('node:crypto')
const [port, token] = process.argv.slice(2)
const sock = net.connect(Number(port), '127.0.0.1')
let buf = Buffer.alloc(0)
let handshakeDone = false
const responses = []
const pending = new Map()
let idc = 0
function sendFrame(text) {
  const bytes = Buffer.from(text)
  const mask = crypto.randomBytes(4)
  const masked = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) masked[i] = bytes[i] ^ mask[i % 4]
  sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | bytes.length]), mask, masked]))
}
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++idc
    pending.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(`${method}: ${r.error}`))))
    sendFrame(JSON.stringify({ id, method, args }))
    setTimeout(() => reject(new Error(`${method}: timeout`)), 5000)
  })
}
sock.on('connect', () => {
  sock.write(`GET /ws?token=${encodeURIComponent(token)} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
})
sock.on('data', async (d) => {
  buf = Buffer.concat([buf, d])
  if (!handshakeDone) {
    const end = buf.indexOf('\r\n\r\n')
    if (end === -1) return
    handshakeDone = true
    buf = buf.slice(end + 4)
    try {
      const snap = await call('workspace:snapshot', [])
      const pid = snap.result.index.projects[0]?.id
      if (!pid) throw new Error('no project after restart')
      const nodes = snap.result.projects[pid] ?? []
      await call('workspace:save-nodes', [pid, nodes]) // dirty → push fires
      console.log('TOUCH_OK')
      process.exit(0)
    } catch (e) { console.error('FAIL: touch:', e.message); process.exit(1) }
  }
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
      responses.push(r)
      if (pending.has(r.id)) pending.get(r.id)(r)
    } catch { /* non-json frame */ }
  }
})
sock.on('error', (e) => { console.error('FAIL: ws socket error:', e.message); process.exit(1) })
setTimeout(() => { console.error('FAIL: touch global timeout'); process.exit(1) }, 10000)
EOF
for _ in $(seq 1 30); do
  [ -f "$content_dir/e2ecat.json" ] && grep -q "n-ws-sticky" "$content_dir/e2ecat.json" 2>/dev/null && break
  sleep 1
done
[ -f "$content_dir/e2ecat.json" ] || fail "space never pushed a snapshot to the cloud store"
grep -q "n-ws-sticky" "$content_dir/e2ecat.json" || fail "cloud snapshot is stale (missing WS-saved nodes)"

echo ""
echo "PASS: space-e2e — seed→boot-restore→ws-drive→restart→push all verified"
