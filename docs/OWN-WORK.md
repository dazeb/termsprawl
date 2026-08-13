# OWN-WORK.md — concepts we originated (design reference)

*Purpose: this file records which features and design concepts in the prior
fork (`../nodeterm-linux`) are genuinely OURS — so Phase 11 can rebuild them
from scratch, with better features, without ever touching the fork's files.
We do NOT port code, not even our own: every line in termsprawl is written
fresh. The fork is read-only source material for ideas.*

*Provenance: git-author separation in the fork — 997 upstream commits (author
`enes`) vs 42 of ours (authors `dazeb` / `Darren Bennett`, starting
2026-07-15). Regenerate with:*

```bash
cd ../nodeterm-linux
AUTH="--author=dazeb --author=Darren"
git log --format='' --name-only --diff-filter=A $AUTH | grep -v '^$' | sort -u   # files we ADDED
git log --format='' --name-only --diff-filter=M $AUTH | grep -v '^$' | sort -u   # upstream files we MODIFIED
git log --format='' --name-only --diff-filter=D $AUTH | grep -v '^$' | sort -u   # upstream files we DELETED
```

**How to use this file:** read a section, take the *concept* (what the feature
did, why it existed, rough shape), then design a v2 that is strictly better.
The file paths point at the fork's implementation for concept-reading only —
they are never copied into this repo.

---

## A. Telegram bot (concept: local bot controlling the app from a phone)

What we built in the fork: a local Telegram bot (no relay) that lists open
projects/sessions, attaches to a terminal, sends keystrokes, and surfaces
captured output — plus device pairing (approve flow, token store, masked
form), an approval workflow for allowed users, and a menu with status buttons.

Concept points worth keeping in v2:
- pairing/approval flow (secure by default — nothing works until the desktop
  owner approves)
- /terminals /attach /send /help command surface
- session↔project awareness (bot sees the workspace, not just raw shells)
- privacy: masked bot token form, persist bot id

v2 improvement ideas (design, don't inherit): multi-channel delivery
(Telegram + Matrix later), inline keyboards for node pick, read-only viewer
mode, per-node allowlist, session-scoped attach tokens.

## B. Hosted relay service (concept: E2E relay between hosts and phones)

What we built in the fork: a standalone Node service (`src/relay-service/` —
GitHub device-flow auth, host sessions, pairing invites with quotas,
E2E-encrypted relay frames, SQLite/pg-backed repository). It was fully
self-contained (only node builtins + `pg` + its own modules) — the cleanest
concept in the set to rebuild.

Concept points worth keeping in v2:
- GitHub device-flow auth (no passwords)
- host sessions + invite quotas
- E2E relay frames (server never sees plaintext)

v2 improvement ideas: WebRTC data-channel direct path with relay fallback,
per-invite expiry + revocation, admin API, usage metrics, optional Tailscale
discovery instead of a public relay.

## C. Provider-agnostic chat driver (concept: SDK chat, not a PTY)

What we built in the fork: replaced the Claude-only SDK chat with a
provider-agnostic LLM driver — streaming, permission cards, stop, thinking
blocks, slash commands, image paste, diff cards, cost chip, resume-based
continuity. Implemented inside upstream files (`core/chat-driver.ts`,
`nodes/ChatNode.tsx`), so the fork's file contents are entangled — another
reason this is concept-only.

v2 improvement ideas: unified agent/chat surface with the Phase 7 agent
registry, token-budget meter per provider, model routing by job, conversation
branching.

## D. Fork features we modified (concept notes)

- **Free Pro removal** — we stripped the license/subscription gates to
  always-permitted stubs. termsprawl simply has no licensing; nothing to carry.
- **Linux port** — electron-builder AppImage/.deb, icon, Ctrl-based shortcut
  display. termsprawl's own packaging (Phase 12, done) already supersedes it.
- **Auto-updates** — we switched the update feed from the upstream server to
  GitHub Releases. Concept: own the update channel; termsprawl Phase 12 does
  this natively.

## E. What we deleted in the fork (record)

UpgradeDialog, license gates (`entitlement-key.ts`, `upgradeGate.ts`,
`LicenseSection.tsx`), macOS phone relay (`PhoneSection.tsx`,
`PhonePairPopover.tsx`, `usePhonePairing.ts`). Decisions only — the fork went
100% free and dropped the macOS phone path in favour of Telegram. termsprawl
inherits the decisions, not the code.

**No macOS features, ever.** The macOS phone relay is explicitly not coming
back in any form — termsprawl is Linux-only, and the Telegram bot covers
phone control. Anything macOS-specific in the fork (entitlements plist,
phone pairing, Continuity-style flows) is out of scope by rule.

## Our planning docs (context for v2 specs)

- `.hermes/PLAN-telegram-team-access.md` in the fork — our original plan for
  Telegram + team access. Ours; useful background for Phase 11 spec writing.

## Phase 11 workflow (maps to PLAN.md)

1. [ ] Read the relevant section above + skim the fork file paths for concept.
2. [ ] Write the v2 spec with the improvement ideas (better, not equal).
3. [ ] Implement fresh against termsprawl's own core/shared — no imports from
      the fork, no file copied, no diff lifted.
4. [ ] Run `./scripts/check-originality.sh` — a FAIL is a hard stop.
