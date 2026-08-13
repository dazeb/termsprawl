# OWN-WORK.md — our prior work, marked for porting

*Purpose: this file is the definitive inventory of what is genuinely OURS in
the prior fork (`../nodeterm-linux`), so Phase 11 (task 11.1) ports with
confidence and never drags upstream expression across. It was produced by
git-author separation — the fork has 997 upstream commits (author `enes`) and
42 of ours (authors `dazeb` / `Darren Bennett`, starting 2026-07-15).*

## Regenerating this inventory

```bash
cd ../nodeterm-linux
AUTH="--author=dazeb --author=Darren"
git log --format='' --name-only --diff-filter=A $AUTH | grep -v '^$' | sort -u   # files we ADDED
git log --format='' --name-only --diff-filter=M $AUTH | grep -v '^$' | sort -u   # upstream files we MODIFIED
git log --format='' --name-only --diff-filter=D $AUTH | grep -v '^$' | sort -u   # upstream files we DELETED
```

## Porting rules (summary)

| Category | Rule |
|---|---|
| **PURE OURS** (files we added) | Port as-is, then audit imports for seams (below). |
| **ENTANGLED** (upstream files we modified) | Do NOT copy the file. Extract the *concept* and reimplement against termsprawl's own core/shared. The expression is mixed with upstream's — clean-room requires a rewrite. |
| **DELETED** (upstream files we removed) | Only the *decision* is ours (free Pro, no macOS phone relay). Nothing to port. |

---

## A. Telegram bot — PURE OURS, three seams

Files we added (port as-is):

```
src/core/telegram-bot.ts            src/core/telegram-commands.ts
src/core/telegram-menu.ts           src/core/telegram-approved.ts
src/core/telegram-bot-info.ts       src/core/telegram-pairing.ts
src/core/telegram-*.test.ts         (one per module)
src/main/telegram-token-store.ts    src/main/telegram-token-store.test.ts
src/renderer/state/telegramBot.ts   src/renderer/components/TelegramPairingDialog.tsx
src/renderer/components/settings/sections/TelegramSection.tsx
```

Third-party: `telegraf` (MIT — keep, it's a library).

**Seams to rewrite at port time** (imports reaching into upstream, from the
2026-08-13 audit):

- `../shared/ipc` → IPC channel names (termsprawl has its own in `src/shared/ipc.ts`)
- `../shared/types` → shared types (termsprawl's own)
- `./platform` → upstream's core platform abstraction (termsprawl's `CorePlatform` seam is the analogue)

The bot logic itself (commands, menus, pairing, approval, token store) imports
only node builtins + telegraf + those three seams.

## B. Hosted relay service — PURE OURS, standalone

Files we added (port as-is):

```
src/relay-service/api.ts          src/relay-service/api.test.ts
src/relay-service/auth.ts         src/relay-service/auth.test.ts
src/relay-service/config.ts       src/relay-service/config.test.ts
src/relay-service/db.ts           src/relay-service/github.ts
src/relay-service/github.test.ts  src/relay-service/repository.ts
src/relay-service/repository.test.ts
src/relay-service/migrations/001_initial.sql
```

The service is **fully self-contained**: imports only its own modules + node
builtins (`http`, `crypto`, `path`, `fs`) + `pg` + vitest. No upstream imports.
This is the cleanest port in the set — a standalone Node service, exactly as
PLAN.md task 11.2 describes.

Client-side pieces we added (port with them, audit imports):

```
src/main/remote/host-session-store.ts       src/main/remote/host-session-store.test.ts
src/main/remote/hosted-relay-client.ts
src/main/remote/invite-deep-link.ts         src/main/remote/invite-deep-link.test.ts
src/main/invite-protocol.ts                 src/main/invite-protocol.test.ts
src/renderer/lib/remoteInvite.ts            src/renderer/lib/remoteInvite.test.ts
src/renderer/components/RemoteInviteDialog.tsx
```

`hosted-relay-client.ts` imports `../telegram-token-store` (ours) and
`./remote/invite-deep-link` (ours) — clean. Re-verify each at port time.

## C. Provider-agnostic chat driver — CONCEPT ours, FILES entangled

The concept (provider-agnostic SDK driver with streaming, permission cards,
cost chip, multi-provider) is ours — commit `867909b feat(chat): replace
Claude-only SDK with provider-agnostic LLM driver`. BUT it was implemented by
**modifying upstream files**:

```
src/core/chat-driver.ts            (upstream file, modified by us)
src/renderer/nodes/ChatNode.tsx    (upstream file, modified by us)
```

**Porting rule: do not copy these files.** Reimplement the driver against
termsprawl's own core/renderer (FEATURES.md §5 already marks chat node as
"[own concept, reimplemented]"). What is ours here: the driver design, the
multi-provider interface, the UI behaviors — not the file contents.

## D. Entangled upstream files we modified — extract concepts only

These carry upstream expression; we added our features inside them. Rewrite
against termsprawl; do not diff-copy:

- **Free Pro removal** (decision ours, code was upstream's): `src/core/license.ts`,
  `src/renderer/state/entitlement.ts` — our change was to strip license gates to
  always-permitted stubs. termsprawl has no licensing at all; nothing to port.
- **Linux port**: `package.json`, `electron.vite.config.ts`, `tsconfig.node.json`,
  `vitest.config.ts`, `.github/workflows/release.yml` — termsprawl's packaging
  already supersedes this (own electron-builder config, own scripts).
- **Settings/UI additions**: `settings/SettingsPage.tsx`, `settings/nav.ts`,
  `settings/SettingsIcons.tsx`, `settings/sections/TeamAccessSection.tsx`,
  `settings/teamAccessView.ts`, `components/PhonePairPopover.tsx` (later
  deleted), `components/ShortcutsPanel.tsx` (Ctrl-shortcut display), `stubs.ts`,
  `bridge/stubs.ts`, `bridge/stubs.test.ts` — our settings sections and shortcut
  panel concepts are ours; the files are upstream scaffolds.
- **Remote/SSH/updater touches**: `main/remote/relay-host.ts`,
  `main/remote/relay-socket.ts`, `main/remote/relay-host-service.ts`,
  `main/updater.ts` (switch to GitHub Releases), `components/UpdateCard.tsx`,
  `components/RemoteAccessDialog.tsx`, `components/SshProjectDialog.tsx`,
  `canvas/Canvas.tsx`, `state/workspace.ts`, `shared/ipc.ts`, `shared/types.ts`,
  `preload/index.ts`, `core/check.ts`, `core/settings-store.ts` — verify each
  concept at Phase 8/9/11 port time; treat file contents as upstream.
- **Docs we rewrote**: `README.md` (Linux fork rewrite), `docs/remote-sessions.md`
  — concepts reusable, text is ours but trivial to write fresh.

## E. What we deleted (for the record)

Upstream files removed by us — the *decisions* are ours, nothing to port:

```
src/core/entitlement-key.ts  src/core/license.test.ts
src/renderer/state/upgradeGate.ts
src/renderer/components/UpgradeDialog.tsx
src/renderer/components/settings/sections/LicenseSection.tsx
src/renderer/components/PhonePairPopover.tsx
src/renderer/components/settings/sections/PhoneSection.tsx
src/renderer/components/settings/usePhonePairing.ts
```

These were the paid-tier + macOS-phone-relay machinery: we stripped the
license/subscription system ("100% free") and replaced the macOS phone relay
with the Telegram bot. termsprawl starts from the stripped concept.

## Our planning docs (context for porting)

- `.hermes/PLAN-telegram-team-access.md` in the fork — our original plan for
  Telegram + team access. Ours; read it before porting the bot/relay.

## Port checklist (maps to PLAN.md task 11.1)

1. [ ] Re-run the regeneration commands above (history is the source of truth).
2. [ ] Port relay-service/ verbatim-ish (standalone; add its own README).
3. [ ] Port telegram bot: rewrite the three seams (ipc / types / platform) onto termsprawl's own.
4. [ ] Chat driver: reimplement, do not copy (entangled).
5. [ ] Client relay pieces: port, verify each import stays within our files.
6. [ ] Run `./scripts/check-originality.sh` over every ported file — a FAIL is a hard stop.
