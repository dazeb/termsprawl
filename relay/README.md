# termsprawl-relay

Standalone relay service for [termsprawl](../README.md) — the spatial terminal
manager. A phone (or any second device) reaches the terminal running on your
desktop through this relay.

**Zero-dependency philosophy:** the only npm dependency is `ws` (WebSocket
server/client). Everything else is Node builtins (`node:http`, `node:crypto`,
`node:fs`, `node:path`). Plain ESM JavaScript, no build step, Node >= 22.

**Security is the feature.** The relay never sees plaintext:

- Terminal traffic is carried as end-to-end-encrypted envelopes
  (`{ n, c }` — AES-256-GCM nonce + ciphertext) that the relay routes
  opaquely. The relay never holds keys and never parses envelope contents.
- Key agreement happens peer-to-peer: each side sends its X25519 public key
  during pairing; the relay only forwards them. Both sides derive the shared
  key locally via HKDF-SHA256.
- Auth is required on every socket. Hosts authenticate with a GitHub token
  (device flow — no passwords); only the SHA-256 hash of the token is ever
  stored. Clients pair using single-use invites minted by their host.
- The dev-only auth bypass refuses to start when `NODE_ENV=production` and
  prefixes dev logins (`dev-<login>`) so dev identities can never be
  mistaken for real ones.

## Architecture

```
src/
  store.mjs        JSON file store, atomic writes, invite model + quotas
  github-auth.mjs  GitHub device flow (start/poll), login lookup, token hashing
  crypto.mjs       X25519 key pairs, HKDF shared keys, AES-256-GCM seal/open
  hub.mjs          WebSocket hub: host/client sessions, invites, E2E routing
  admin.mjs        Admin API: health, metrics, invite revocation, user removal
  index.mjs        Composition root: http server + hub upgrade + admin routes
  <name>.test.mjs  Tests (vitest, run from the repo root: pnpm vitest run relay)
```

### Protocol (JSON text frames)

```jsonc
// handshake — hosts prove identity, clients bring an invite
{ "t": "hello", "role": "host",  "login": "you", "token": "<github PAT>", "pub": "<b64 x25519>" }
{ "t": "hello", "role": "client", "invite": "<8-char code>", "pub": "<b64 x25519>" }

// after pairing, each side learns its peer's public key...
{ "t": "peers", "peer": { "login": "you", "pub": "<b64>" } }

// ...then traffic is opaque E2E envelopes, routed by id
{ "t": "frame", "to": "host:you", "env": { "n": "<b64 nonce>", "c": "<b64 ct>" } }

// direct-path hint (e.g. WebRTC offer) — routed verbatim, never parsed
{ "t": "direct-offer", "to": "client:1", "endpoint": "..." }

// errors
{ "t": "error", "code": "EXPIRED" | "REVOKED" | "EXHAUSTED" | "UNKNOWN" | "NOBODY-HOME" | ... }
```

Offline clients buffer up to 100 envelopes; they are flushed on reconnect.

## Running

```sh
pnpm install --dir relay        # or: npm install (inside relay/)

RELAY_DATA_DIR=./data \
GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... \
ADMIN_TOKEN=<random> \
node relay/src/index.mjs        # binds 127.0.0.1:8788
```

Environment:

| Variable          | Default     | Meaning                                       |
| ----------------- | ----------- | --------------------------------------------- |
| `PORT`            | `8788`      | Listen port                                   |
| `RELAY_BIND`      | `127.0.0.1` | Bind address                                  |
| `RELAY_DATA_DIR`  | `./data`    | Where the JSON store lives                    |
| `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` | — | OAuth app for device flow |
| `ADMIN_TOKEN`     | —           | Bearer token for `/admin/*` (required)        |
| `RELAY_DEV_AUTH`  | —           | `1` = accept unauthenticated dev hosts (refuses under `NODE_ENV=production`) |

## Admin API

```
GET    /healthz                        → 200 {ok:true}          (no auth)
GET    /admin/stats                    → metrics                (Bearer ADMIN_TOKEN)
POST   /admin/invites/:code/revoke     → revoke an invite       (Bearer ADMIN_TOKEN)
DELETE /admin/users/:login             → remove a host user     (Bearer ADMIN_TOKEN)
```

## Invites

Hosts mint invites (8-char crypto-random code, 7-day TTL, default single-use,
max 5 active per host). A client redeems one at the hub during `hello`;
expired/revoked/exhausted/unknown codes are rejected with typed error frames.
Admins can revoke any invite by code.

## Tests

From the repo root:

```sh
pnpm vitest run relay
```

The hub tests exercise real sockets against a real ephemeral HTTP server —
no mocks at the transport layer. Envelope plaintext is asserted only after
the test itself decrypts it, proving the relay never needed to see it.
