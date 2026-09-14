# Task 8 General settings report

Implemented and reviewed the General settings scope.

- Added normalized, persisted `terminalFontFamily`, `terminalProfile`, and `httpProxy` fields to app settings.
- Added General panel controls for terminal font, inherited terminal profile, and HTTP proxy.
- HTTP proxy is concretely supported for terminal and agent child processes: a configured URL is propagated as `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, and `https_proxy` in the PTY environment. The value is trimmed during settings normalization; blank input clears it.
- Terminal nodes wait for `settings.get()` before creating xterm or the PTY, so persisted font and profile settings apply on first mount. The configured profile is passed as `TERMSPRAWL_TERMINAL_PROFILE`.
- Capability pages now honor `supported` and `reason`, rendering an explicit unavailable state instead of empty results. This covers Server Edition responses.
- Usage now carries `supported` and `reason`; the current backend truthfully reports that collection is not implemented, while the renderer still renders summary, daily, and model details whenever supported data exists.
- Fixed the PTY request type documentation and added the missing contract coverage.

Validation output:

- `pnpm run typecheck` — exit code 0 (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`).
- `pnpm vitest run src/core/app-settings.test.ts src/core/pty-manager.test.ts src/shared/settings-contracts.test.ts` — exit code 0; 3 files passed, 51 tests passed.
- `git diff --check` — exit code 0.

The PTY integration suite prints expected tmux socket connection messages during cleanup paths.
