# SPACES-OPS — operating online canvas spaces (Phase 15)

Audience: whoever operates hermes-box. Written at v1 launch; keep honest.

## What is running

| Piece | Where | What it is |
|---|---|---|
| `termsprawl-cloud.service` | box, `/opt/termsprawl-cloud`, port 8787 (loopback) | Cloud API: auth, billing, backups, spaces control plane, space-content store |
| `space-router.service` | box, same checkout, port 3030 (loopback) | Maps `canvas.termsprawl.com/<login>` → the user's container port; auth gate + wake |
| `ts-space-<login>` containers | docker on the box, loopback ports 3101–3199 | One Server Edition instance per Pro user (image `ts-space:latest`) |
| Caddy | box | TLS for `canvas.termsprawl.com` → 127.0.0.1:3030; `termsprawl.com/api` → 8787 |

DNS: `canvas.termsprawl.com` A → 178.104.6.193, **DNS-only** (grey cloud) so
Caddy terminates TLS and ACME stays clean. Do not orange-cloud it without
re-thinking the WebSocket path.

## What's in the image

`ts-space:latest` ships the full agent bench the canvas expects (registry:
`src/shared/agents/config.ts`), installed by the vendors' own latest-channel
installers at image build time (not pinned — rebuild to update):

| Command | What | Notes |
|---|---|---|
| `claude` | Claude Code | Anthropic native installer → `~/.local/bin/claude` |
| `codex` | Codex CLI | npm global (`@openai/codex`) → `/usr/local/bin/codex` |
| `grok` | Grok CLI | x.ai installer → `~/.grok/bin/grok` (+ `~/.local/bin` link) |
| `agy` | Antigravity | Google's flat native build → `~/.local/bin/agy` |
| `gemini` | → Antigravity | `/usr/local/bin/gemini` shim execs `agy` (legacy name) |

All four CLIs keep auth/config under `$HOME` (~/.claude, ~/.codex, ~/.grok,
~/.gemini). Those paths are symlinks into `/data/cli-auth` on the space
volume, so a user logs into each CLI ONCE and the session survives container
recreation (stop/wake, reconcile-after-reboot, image update). The image also
carries a seed copy (/opt/cli-seed): a space volume created before this image
is initialized with fresh CLI config dirs on next boot. Browser-based logins
(claude, agy) print an authorization URL in the terminal — paste the code
back; the container has no browser.

A fresh space's Welcome project is seeded with one terminal node (Server
Edition boot, `src/server/index.ts`) so an empty canvas never greets a user.

**Disk is shared, not per-user.** The image is ~2.55 GB but Docker stores
layers ONCE per host — every space container mounts the same read-only
layers, so 99 spaces still cost 2.55 GB of disk, not 99 × 2.55 GB. What each
container uniquely owns is its writable layer (starts at ~4 kB, grows only
with what the user writes) plus its `/data` volume (projects, scrollback,
CLI auth — all small text). Verified empirically: two fresh containers each
reported 4.1 kB writable layer while sharing the 1.83 GB virtual image.

**GitHub import (Phase 17).** Spaces clone a user's connected GitHub repos
via two cloud endpoints: `GET /api/v1/github/repos` (listing) and
`POST /api/v1/github/import-url` (90-second `x-access-token` clone URL;
session cookie OR the space's space-sync JWT; 30 req/min/user). The GitHub
token itself NEVER leaves the cloud — it lives in the per-user encrypted
vault (`DATA_DIR/vault.json`, AES-256-GCM), written at device-flow login
(scope now includes `repo`; existing users re-consent once). `DELETE
/api/v1/github/connection` wipes it (Settings disconnect). The container
clones into `<TERMSPRAWL_DATA>/projects-src/<repo>` and adds the project;
a boot-time suggestion broadcast (`github:suggest`) lists repos not yet on
the canvas. pnpm 11.22.0 ships in the image; every project installs from
ONE per-user store (`/data/pnpm-store` on the volume) via the `pnpmi`
helper — installs are explicit, never automatic on import.

## Capacity math (the honest version)

- Container caps: `--memory 384m --cpus 0.5 --pids-limit 128` per space.
  The cap is a ceiling, not usage: an idle space runs ~60–100 MB RSS
  (node + tmux). Budget ~100 MB/idle space, ~384 MB under load.
- Box: 7.6 GB RAM shared with the cloud API, Caddy, docker, and the host.
- Practical ceiling before RAM pressure: **~20 concurrent spaces**.
  Alert threshold: **60% of memory** (`free -m` used ≥ 4600).
- Port pool 3101–3199 caps the design at 99 spaces — the harder limit is RAM.
- The relief valve is idle-stop: containers stop after 30 min without a
  proxied request (wake-on-connect restarts them in seconds; scrollback and
  canvas come back from the volume + cloud snapshot).
- Growth path (user decision 2026-08-31, deferred): if RAM becomes the
  binding limit, upgrade the VPS or move spaces to a dedicated server
  (Hetzner). No per-container tuning before that point — the caps are
  already honest and disk is layer-shared.

## Idle-stop and waking

- v1 ships with wake-on-connect in the router; the idle-stop TIMER itself is a
  v1.1 task (`docs/TODO: idle-stop sweeper`). Until it lands, containers run
  until stopped manually or the box reboots — watch memory.
- Wake path: request → router sees no running space → `ensureRunning` (30 s
  budget) → proxy. Timeout serves a retry page (`Starting your canvas…`,
  meta-refresh 5 s).

## Reconcile after reboot

Cloud API boot runs `spaceManager.reconcile()` (fire-and-forget): containers
for Pro owners are re-created if missing, non-Pro spaces are stopped. The
router itself never provisions — after a reboot, spaces come back either via
reconcile (cloud API) or on first visit (router wake).

## Data & volumes

- Each space: docker volume `ts-space-<login>` mounted at `/data`
  (projects, workspace, settings, tmux sockets, scrollback store).
- Space→cloud snapshots land in `DATA_DIR/spaces/content/<login>.json`
  (latest-per-login, atomic writes, 2 MB cap per payload).
- DELETE /api/v1/spaces/mine stops the container and KEEPS the volume.
  Grace policy: 7 days, then sweep. v1.1 TODO: the sweep job. Until then,
  manual cleanup: `docker volume rm ts-space-<login>`.

## Tokens and secrets (all in /opt/termsprawl-cloud/.env)

- `SPACE_JWT_SECRET` — signs 5-min browser hand-off tokens AND long-lived
  (1 year) `space-sync` tokens given to containers. Rotation: new secret
  invalidates all spaces' sync tokens (they fail 401 on next push; provision
  again via the dashboard to re-mint) and forces users to re-open canvas.
  Do it in a maintenance window.
- `TERMSPRAWL_SERVER_TOKEN` per space — random 48-hex, lives ONLY as
  container env (never persisted, never logged). Rotating = recreate the
  container.
- `JWT_SECRET` / `VAULT_KEY` — existing cloud secrets; unchanged by spaces.

## Kill switch

1. `systemctl stop space-router` — canvas subdomain stops answering (users
   see a connection error; containers keep running).
2. Disable new provisioning: comment out `POST /api/v1/spaces` in the cloud
   API (or set a `SPACES_DISABLED=1` env check) and
   `systemctl restart termsprawl-cloud`.
3. Nuclear: `docker stop $(docker ps -q --filter name=ts-space-)`.

## Log locations

- Router: `journalctl -u space-router -f`
- Cloud API: `journalctl -u termsprawl-cloud -f`
- A space: `docker logs ts-space-<login>` (the boot token is never logged by
  the manager; the space prints its own boot banner)
- Docker resource view: `docker stats --no-stream | grep ts-space`

## Deploy ritual

1. Web repo: `scripts/deploy-hermes-box.sh` publishes the site AND
   server/index.mjs + units (extend it for space-router when onboarding the
   service — see deploy/space-router.service).
2. App repo: `pnpm run build && pnpm run build:server`, then
   `scripts/build-space-image.sh` (app repo) → `docker save ts-space:latest |
   ssh hermes-box docker load` (no registry in v1).
3. `caddy reload --config /etc/caddy/Caddyfile` after vhost edits (the
   deploy script does this; note systemd ExecReload is broken on the box —
   reload directly).

## Decisions locked at kickoff (do not relitigate casually)

- Sync = pull-model snapshots (D1-B). No shared mutable file; last-writer-wins
  per direction with rev comparison. v1 is "snapshot sync", not live merge.
- URL shape: path-based `/<login>` (O-2). Subdomains are a v2 nicety.
- Delete = 7-day grace (O-3); sweep is v1.1.
- Desktop "Open online snapshot" always creates a NEW local project (O-4).
- tmux sessions die with the container; scrollback replays. Honest UI copy.
