# Contributing to termsprawl

Thanks for considering a contribution. termsprawl is pre-1.0 and maintained by
one person, so small, focused changes that arrive with tests and a clear
description are the easiest to review and merge.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Security issues go through [SECURITY.md](SECURITY.md) — never a public issue.

## Prerequisites

- **Linux** — termsprawl is Linux-only by design; macOS and Windows are not
  supported, and PRs adding platform-specific code for them will be declined.
- **Node 20+** (Node 22 is what CI and the maintainer's workstation use)
- **pnpm 11** (`packageManager` in `package.json` pins the exact version;
  the repo uses `node-linker=hoisted` from `.npmrc`)
- **tmux >= 3.2** — terminals run inside tmux sessions; without it the app
  still starts, but session continuity and scrollback restore are lost
- build tools for the `node-pty` native module (on Debian/Ubuntu:
  `build-essential python3`)

## Setup

```bash
pnpm install
pnpm run dev          # Electron dev mode with renderer HMR
```

`pnpm install` rebuilds `node-pty` against Electron's ABI through the
`postinstall` script. Electron 43 has no postinstall script of its own, so on
a fresh clone where `node_modules/electron/dist/electron` is missing, run
`node node_modules/electron/install.js` once.

## Gates (run in this order)

The order matters: the vitest suite includes a Server Edition boot gate that
reads the built renderer, so building first is required. CI runs the same
sequence.

```bash
pnpm run typecheck                        # tsc for node + web projects — start here
pnpm run build                            # production renderer/main build
pnpm run build:server                     # Server Edition bundle
python3 scripts/release-safety.test.py    # offline release failure-path checks
pnpm test                                 # vitest suite (unit + integration)
```

A single canonical `pnpm run verify` command that wraps these gates is planned;
until it lands, run the sequence above.

Extra checks, run when your change touches what they cover:

- `./scripts/check-originality.sh` — see [Clean-room rules](#clean-room-rules)
- `bash scripts/space-e2e.sh` and `bash scripts/github-import-e2e.sh` — the
  manual end-to-end gates for the hosted-space sync and GitHub import paths;
  they are not part of CI and need Docker (or `TS_E2E_SKIP_DOCKER=1` for the
  spaces script) plus, for the import script, a real git host token.
- `pnpm run dist` — packages the AppImage and `.deb`; do this before touching
  packaging-sensitive code.

### Working test-first

Write a focused test that fails for the behaviour you are adding, run just
that test while iterating, then run the full gates:

```bash
pnpm test src/core/your-module.test.ts   # focused run
pnpm test                                # full suite before you open a PR
```

Tests live next to the code (`src/**/*.test.ts`), or under `scripts/` for
repository-level checks. Any change to core behaviour without a test needs a
short explanation in the PR.

## Pull requests

- One topic per PR. Keep diffs small; avoid drive-by reformatting.
- Describe what changed, why, and what you ran. Mention anything you could not
  verify.
- **Docs in the same change.** A user-visible change means updating the
  relevant documentation in this repository (README, `docs/`) in the same PR.
  The docs site (docs.termsprawl.com) tracks shipped behaviour too; say in the
  PR if it needs a matching update.
- Commit messages: a short imperative subject (`fix(browser): …`,
  `feat(agents): …`, `docs: …`); the body explains the reasoning when it is not
  obvious.
- Open the PR against `main` on GitHub. The maintainer syncs branches to a
  self-hosted Gitea runner where CI lives, and reports the result on the PR.
  CI status is not publicly visible.

### No GitHub Actions

This project deliberately does not use GitHub Actions, and the GitHub account
that hosts the public mirror has Actions disabled. CI is a self-hosted Gitea
workflow (`.gitea/workflows/ci.yml`). Please do not add files under
`.github/workflows/` — they will not run and will be rejected.

## Clean-room rules

termsprawl is an independent implementation. Its code, comments, assets, and
docs must be written from scratch:

- Never copy code, comments, structure, assets, or documentation text from
  another terminal-manager project (or any other project) — even a small block.
  Ideas and features are fine; the expression is not.
- Do not paste code you do not have the right to contribute. Vendor logos and
  other assets must have a compatible license, and you must add or update the
  attribution in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Run `./scripts/check-originality.sh` before opening a PR that changes code.
  It is an automated similarity screen: it compares this repository against the
  prior project's tree and flags identical blocks of five or more non-trivial
  lines. A failure is a hard stop, not a nitpick. The screen is a heuristic,
  not a legal guarantee — see
  [docs/VERIFICATION.md](docs/VERIFICATION.md) for its methodology and limits.

## Licensing of contributions

termsprawl is MIT-licensed (see [LICENSE](LICENSE)). By submitting a
contribution you agree that it may be distributed under the MIT license. There
is no CLA or DCO sign-off requirement — no copyright assignment is asked for,
and you keep the copyright on your work.

## Becoming a maintainer

Sustained contributors are welcome to take on more responsibility. The path
and the current decision process are documented in
[GOVERNANCE.md](GOVERNANCE.md).

## Questions

Open a GitHub issue for design questions or setup problems (non-security), or
read [AGENTS.md](AGENTS.md) for the repository's operational conventions.
