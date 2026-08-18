# AGENTS.md — src/main/agents

Agent hook server — the machinery behind RUNNING / NEEDS YOU badges and
notifications.

## Contents

- `hook-server.ts` — local HTTP hook server; agent CLIs (Claude et al.) POST
  lifecycle events here.
- `hook-installer.ts` — writes the hook config into agent CLI settings.
- `*.test.ts` — unit tests; `test-live-hooks.sh` in scripts/ is the live gate
  (boot app, POST events, verify fail-open).

## Rules

- Fail-open: if the hook server is down, agents must still work.
- Keep hook payloads aligned with `src/shared/agent-status.ts` types.

See ../../../AGENTS.md for repo-wide conventions and legal rules.
