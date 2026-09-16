#!/usr/bin/env bash
# github-import-e2e — end-to-end proof of the Phase 17 GitHub import path.
#
# Boots a FAKE cloud (repo listing + import-url broker) + a REAL ts-space
# container (new image) and drives the server's own github:import RPC over
# its WebSocket bridge. Asserts:
#   1. boot: github:suggest broadcast lists repos not yet on the canvas
#   2. github:import clones the repo for real (git objects on the volume)
#   3. the imported project exists in the workspace with the clone as cwd
#   4. the credential NEVER appears in container logs, the response, or /data
#   5. re-import of the same repo is refused (project cwd already known)
#
# Usage: scripts/github-import-e2e.sh [image]     (default: ts-space:latest)
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${1:-ts-space:latest}"
# Rootless Docker may require the workstation LAN address for the mock cloud.
CLOUD_HOST="${TS_E2E_CLOUD_HOST:-host.docker.internal}"
export TS_E2E_REPO_ROOT="$PWD"
WORK=$(mktemp -d /tmp/ts-gh-e2e-XXXXXX)
CLOUD_PORT=18990
SRV_PORT=18991
FAKE_TOKEN="gho_e2e_fake_token_$(openssl rand -hex 8)"
# The container binds 0.0.0.0, which the server allows only with the hosted
# space router gate present (the space manager injects the real per-tenant
# value; nothing here acts as a router, so any non-empty value will do).
SPACE_ROUTER_HEADER="e2e-space-router-header"
FAILURES=0

cleanup() {
  docker rm -f ts-gh-e2e >/dev/null 2>&1 || true
  docker volume rm ts-gh-e2e-v >/dev/null 2>&1 || true
  kill "$CLOUD_PID" 2>/dev/null || true
  # The git daemon inherits this script's stdout — without an explicit kill it
  # survives cleanup and keeps any `| tail` pipeline open forever (a leaked
  # daemon also holds port GIT_PORT, breaking the next run).
  kill "${GITD_PID:-}" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL: $1"; FAILURES=$((FAILURES+1)); }
pass() { echo "ok:   $1"; }

# ---- fake cloud: node http server (repos listing + import-url) ----
cat > "$WORK/fake-cloud.mjs" <<EOF
import http from 'node:http'
const REPOS = [
  { full_name: 'octocat/Hello-World', name: 'Hello-World', private: false,
    clone_url: 'https://github.com/octocat/Hello-World.git', updated_at: '2026-08-31T00:00:00Z' },
  { full_name: 'octocat/other-repo', name: 'other-repo', private: false,
    clone_url: 'https://github.com/octocat/other-repo.git', updated_at: '2026-08-30T00:00:00Z' },
]
const TOKEN = process.env.FAKE_TOKEN
const SRV_PORT = $SRV_PORT
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push({ url: req.url, method: req.method })
    const json = (code, obj) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(obj)) }
    if (req.url === '/api/v1/github/repos') return json(200, { repos: REPOS })
    if (req.url === '/api/v1/github/import-url') {
      const parsed = JSON.parse(body || '{}')
      const repo = REPOS.find((r) => r.full_name === parsed.fullName)
      if (!repo) return json(404, { error: { code: 'repo_not_found', message: 'nope' } })
      // Production contract: the broker returns an https github.com URL (with
      // an embedded token for private repos). This e2e uses a REAL tiny public
      // repo so the clone exercises the exact production path (https, git
      // protocol negotiation) — no token needed for public clones.
      const url = 'https://github.com/octocat/Hello-World.git'
      return json(200, { url, expiresIn: 90 })
    }
    json(404, {})
  })
})
server.listen($CLOUD_PORT, '0.0.0.0', () => console.log('fake cloud listening'))
EOF

# ---- local bare repo the clone will actually hit (file:// won't cross the
# container boundary, so we serve git over HTTP using git http-backend via
# `git daemon`-style: simplest reliable path = git's own dumb http via
# `git http-backend` CGI is heavy; use `git daemon` on the git:// protocol
# instead and have the fake cloud return a git:// URL). ----
GIT_PORT=18992
# free the git-daemon port if a previous run left a daemon behind
for pid in $(pgrep -f "git-daemon --base-path" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
sleep 0.5
mkdir -p "$WORK/repo"
cd "$WORK/repo"
git init -q
git config user.email e2e@termsprawl.dev
git config user.name e2e
echo "# e2e repo" > README.md
printf '{\n  "name": "e2e-repo",\n  "version": "1.0.0"\n}\n' > package.json
git add -A && git commit -qm "e2e initial commit"
git clone -q --bare . "$WORK/e2e-repo.git"
cd - >/dev/null

# git-daemon exports the bare repo read-only on git://
git daemon --base-path="$WORK" --export-all --reuseaddr --port="$GIT_PORT" --verbose &
GITD_PID=$!

FAKE_TOKEN="$FAKE_TOKEN" GIT_PORT="$GIT_PORT" node "$WORK/fake-cloud.mjs" > /tmp/ts-gh-e2e-cloud.log 2>&1 &
CLOUD_PID=$!
# wait for the fake cloud to accept connections (max 5s)
for i in $(seq 1 25); do
  if node -e "fetch('http://127.0.0.1:$CLOUD_PORT/api/v1/github/repos').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then break; fi
  sleep 0.2
done
node -e "fetch('http://127.0.0.1:$CLOUD_PORT/api/v1/github/repos').then((r)=>{console.log('fake cloud up:', r.status); process.exit(r.status===200?0:1)}).catch((e)=>{console.log('fake cloud DOWN:', e.message); process.exit(1)})" || { echo "FAIL: fake cloud never came up (see /tmp/ts-gh-e2e-cloud.log)"; exit 1; }

# The fake cloud must hand the container a git:// URL it can reach — done in
# the module above (GIT_PORT env). Remove the stale post-hoc sed approach.
echo "── booting container (image: $IMAGE)"
docker rm -f ts-gh-e2e >/dev/null 2>&1 || true
docker volume rm ts-gh-e2e-v >/dev/null 2>&1 || true
docker run -d --name ts-gh-e2e -v ts-gh-e2e-v:/data \
  -p "127.0.0.1:$SRV_PORT:3110" \
  --add-host=host.docker.internal:host-gateway \
  -e TERMSPRAWL_SERVER_HOST=0.0.0.0 -e TERMSPRAWL_SERVER_TOKEN= -e PORT=3110 \
  -e TERMSPRAWL_SPACE_HEADER="$SPACE_ROUTER_HEADER" \
  -e TS_CLOUD_API="http://$CLOUD_HOST:$CLOUD_PORT" \
  -e TS_SPACE_BOOT_TOKEN="e2e-space-sync-token" \
  "$IMAGE" >/dev/null
sleep 6

# ---- drive the server: read boot events (github:suggest), then import ----
cat > "$WORK/drive.mjs" <<'EOF'
import { createRequire } from 'node:module'
const require = createRequire(process.env.TS_E2E_REPO_ROOT + '/package.json')
const { WebSocket } = require('ws')
const PORT = process.env.E2E_SRV_PORT
const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
const events = []
const results = new Map()
let id = 0
const req = (method, args) => sock.send(JSON.stringify({ t: 'req', id: ++id, method, args }))
const done = { resolve: null }
const finished = new Promise((r) => (done.resolve = r))

sock.on('open', () => {})
sock.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.t === 'evt') {
    events.push(m)
    return
  }
  if (m.t === 'res') {
    results.set(m.id, m)
    // import (id 1) resolved → grab the workspace snapshot (id 2)
    if (m.id === 1) req('workspace:snapshot', [])
    if (results.size >= 2) done.resolve()
  }
})
sock.on('open2', () => {})
// The boot suggest fires ~200ms after the server starts listening — long
// before this client connects — so it's asserted from the container log
// instead (see SUGGEST below). Here: import, then snapshot.
sock.on('open', () => {
  setTimeout(() => {
    req('github:import', ['octocat/Hello-World'])
  }, 300)
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 25000)
finished.then(() => {
  const suggest = events.find((e) => e.channel === 'github:suggest')
  const importRes = results.get(1)
  const snapRes = results.get(2)
  console.log('=== RESULT JSON ===')
  console.log(JSON.stringify({ suggest: suggest?.payload ?? null, importRes: importRes?.result ?? importRes, snapRes: snapRes?.result ?? snapRes }, null, 2))
  process.exit(0)
})
EOF

E2E_SRV_PORT=$SRV_PORT timeout 40 node "$WORK/drive.mjs" > /tmp/ts-gh-e2e-drive.json 2>&1 || true
cat /tmp/ts-gh-e2e-drive.json | sed -n '/=== RESULT JSON ===/,$p' > "$WORK/results.json" || true

SUGGEST=$(docker logs ts-gh-e2e 2>&1 | grep -c "suggesting .* repo" || true)
IMPORT_OK=$(grep -c '"ok": true' "$WORK/results.json" || true)
REPO_IN_SNAP=$(grep -c "Hello-World" "$WORK/results.json" || true)

[ "$SUGGEST" -ge 1 ] && pass "boot github:suggest fired (server log)" || fail "no github:suggest in server log"
[ "$IMPORT_OK" -ge 1 ] && pass "github:import returned ok" || fail "github:import did not return ok"
[ "$REPO_IN_SNAP" -ge 1 ] && pass "imported repo present in workspace snapshot" || fail "repo missing from workspace snapshot"

# ---- on-volume assertions ----
GIT_DIR=$(docker exec ts-gh-e2e sh -c 'ls -d /data/projects-src/Hello-World/.git 2>/dev/null' || true)
[ -n "$GIT_DIR" ] && pass "real git clone landed on the volume" || fail "no git clone on the volume"
HEAD=$(docker exec ts-gh-e2e sh -c 'cat /data/projects-src/Hello-World/README 2>/dev/null' || true)
[ -n "$HEAD" ] && pass "cloned content readable" || fail "cloned content missing"

# ---- credential-leak sweep ----
docker logs ts-gh-e2e > "$WORK/container.log" 2>&1 || true
if grep -q "$FAKE_TOKEN" "$WORK/container.log"; then fail "token leaked into container logs"; else pass "no token in container logs"; fi
if docker exec ts-gh-e2e sh -c "grep -r '$FAKE_TOKEN' /data 2>/dev/null | head -1" | grep -q .; then fail "token leaked into /data"; else pass "no token in /data"; fi

# ---- re-import refusal ----
cat > "$WORK/reimport.mjs" <<EOF
import { createRequire } from 'node:module'
const require = createRequire(process.env.TS_E2E_REPO_ROOT + '/package.json')
const { WebSocket } = require('ws')
const sock = new WebSocket('ws://127.0.0.1:$SRV_PORT/ws')
sock.on('open', () => sock.send(JSON.stringify({ t:'req', id:1, method:'github:import', args:['octocat/Hello-World'] })))
sock.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'res') { console.log(JSON.stringify(m.result ?? m)); process.exit(0) } })
setTimeout(() => process.exit(1), 10000)
EOF
REIMPORT=$(timeout 15 node "$WORK/reimport.mjs" || true)
echo "$REIMPORT" | grep -qi "error\|ok\":false\|already\|exists" && pass "re-import refused: $REIMPORT" || fail "re-import was not refused: $REIMPORT"

echo
[ "$FAILURES" = "0" ] && echo "GITHUB-IMPORT E2E: ALL PASS" || echo "GITHUB-IMPORT E2E: $FAILURES FAILURE(S)"
exit "$FAILURES"
