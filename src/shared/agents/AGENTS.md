# AGENTS.md — src/shared/agents

Agent registry configuration — shared, process-agnostic.

## Contents

- `config.ts` — agent presets (CLI launch commands, capability lists, hook
  settings) for Claude / Codex / Gemini / Grok / custom. `*.test.ts` covers
  the normalizers.

## Rules

- New agent presets are data, not logic — add them to config.ts, keep the
  registry generic.
- Capability lists gate features (hooks, resume, branch, context links) per
  CLI — don't claim a capability a CLI doesn't have.

See ../../../AGENTS.md for repo-wide conventions.
