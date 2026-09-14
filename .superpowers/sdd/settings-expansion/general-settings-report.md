# Task 8 General settings report

Implemented the General settings scope for terminal font and inherited terminal profile.

- Added normalized, persisted `terminalFontFamily`, `terminalProfile`, and `httpProxy` fields to app settings.
- Added General panel rows for terminal font and inherited terminal profile.
- Terminal nodes use the configured font and pass the configured profile to PTY creation as `TERMSPRAWL_TERMINAL_PROFILE`.
- Kept `httpProxy` as a normalized round trip setting only. There is no concrete proxy consumer in the current application: no HTTP client, agent transport, browser session, or PTY behavior reads this setting. Injecting proxy variables into every terminal would silently change child process behavior, so proxy runtime application is intentionally unsupported and deferred until a concrete consumer and contract exist.
- Fixed the PTY request type documentation and removed the incomplete proxy propagation from terminal creation.

Validation:

- `pnpm run typecheck` passed.
- `pnpm vitest run src/core/app-settings.test.ts src/core/pty-manager.test.ts src/shared/settings-contracts.test.ts` passed: 3 files, 51 tests.
- `git diff --check` passed.

The PTY integration suite may print expected tmux socket connection messages while exercising cleanup paths.
