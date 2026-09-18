# Verification record

**Date:** 2026-09-18 · **Commit:**
`ebc5f66139ec3161653a84fc9e1044c61f557921` · **Release:** v0.28.0
**Maturity:** pre-1.0 · **Run by:** the maintainer (self-verified; no external
reviewer was present)

This is the dated record of what was run against the commit above, what was
skipped, and what was not run at all. It is written to be checked by hand: every
command is listed so a reviewer can repeat it. It is a snapshot, not a
continuously updated dashboard. The narrative summary lives in
[PROJECT-HEALTH.md](PROJECT-HEALTH.md).

## Environment

- Linux (Ubuntu-family desktop), Node 22, pnpm 11, tmux 3.2a
- Desktop and Server Edition builds performed before the test run (the order
  matters — see [Ordering](#ordering))

## Results

| # | Command | Result |
|---|---|---|
| 1 | `pnpm run typecheck` | **passed** — `tsc --noEmit` for the node and web projects |
| 2 | `pnpm run build` | **passed** — desktop renderer/main/preload production build |
| 3 | `pnpm run build:server` | **passed** — Server Edition bundle |
| 4 | `pnpm test` | **1,112 passed, 1 skipped, 0 failed** (see the delta note below) |
| 5 | `python3 scripts/release-safety.test.py` | **passed** — offline release failure-path checks |
| 6 | `./scripts/check-originality.sh` | **OK** — 273 source files scanned against 546 prior-project files; no copied blocks; one known-benign generic CSS block reviewed |

The test suite in row 4 covers 117 test files across the repository (118 once
the trust-layer test added by the grant-readiness task is counted):

> **Delta note (added 2026-09-18, same day).** Row 4 records the snapshot at
> `ebc5f66` before this trust layer existed. The trust-surface policy test
> added with this documentation (`scripts/trust-surface.test.ts`, 53 tests)
> runs in the normal suite, so a fresh `pnpm test` on the branch that carries
> this file reports **1,165 passed + 1 skipped (1,166) across 118 files** —
> exactly the recorded 1,112 plus the 53 new tests. That run was executed to
> check the test-fixture redactions in this task and passed. The counts above
> are left as recorded for the named commit.

| Area | What it covers |
|---|---|
| `src/core/**` | Electron-free services: PTY/tmux lifecycle, scrollback, workspace store and project files, git, SSH remote transport, chat runtime, relay client, Telegram, A2A, cloud/snapshot sync, link engine |
| `src/main/**` | Electron main-process wiring: agent hooks and tool runtime, browser manager and CDP facade, window metrics, relay, cloud, Telegram bot |
| `src/server/**` | Server Edition: RPC surface, security and boundary guards, HTTP/WS behaviour, boot gate |
| `src/renderer/**` | Canvas/state logic, node behaviour (including the browser webview sizing regression), history/undo, markdown, boot overlay |
| `src/shared/**` | Shared contracts and agent preset configuration |
| `relay/src/**` | Relay crypto, hub, admin, GitHub device auth, store, security regressions |

Integration tests that spawn real processes (PTY/tmux, Server Edition boot)
are part of the suite; they are slower than the pure-unit tests and are given
generous timeouts.

### The one skip

`src/core/dependency-install.smoke.test.ts` is skipped unless
`TERMSPRAWL_INSTALL_SMOKE=1` is set. It downloads real agent CLI distributions
into an isolated home and asserts they install and respond to `--help`. It is
opt-in because it needs network access and takes minutes; it is not part of the
normal suite or of CI. **At this snapshot it was not run.**

## Not run for this snapshot

These gates exist in the repository but were **not** executed for this record.
Naming them is part of the point: a verification record that only lists
successes is not useful.

- **Packaging (`pnpm run dist`)** — the AppImage/`.deb` build was not produced
  for this snapshot. The release artifacts for v0.28.0 were produced by the
  release pipeline described in AGENTS.md.
- **End-to-end gates** — `scripts/space-e2e.sh` (hosted-space seed → restore →
  WebSocket drive → PTY → restart → push) and `scripts/github-import-e2e.sh`
  (real git host import). Both are manual pre-release gates that need Docker;
  neither is part of CI. Neither was run for this snapshot. Per PLAN.md's
  release record, the spaces script last passed at the v0.27.0 release (in
  `TS_E2E_SKIP_DOCKER=1` mode), while the GitHub-import script could not run at
  that release either — it needs Docker and the workstation's registry auth was
  failing — so it has no recorded successful run in the release notes read for
  this snapshot.
- **Live installer smoke test** — see above.
- **Packaged-app boot test** — the AppImage/.deb were not launched for this
  snapshot; the last packaged boot verification was performed for v0.27.0.
- **Independent review** — no third party reviewed any of this. The figures here
  are self-reported and reproducible with the listed commands.

## Test categories and their limits

- **Unit tests** dominate the suite. They run against pure modules and
  in-process fakes; they say nothing about a packaged binary.
- **Integration tests** spawn real shells via node-pty, real tmux sessions, and
  a real HTTP/WS Server Edition instance. They depend on the host's tmux and
  shell, so they are the tests most likely to differ on another machine.
- **Renderer tests** run in Node (no browser); the browser-node sizing guard
  asserts the webview display mode is `flex`, which is the mechanism of the
  0.26.0 black-area regression, not a pixel-level rendering check.
- **No UI automation suite.** There is no Playwright/Spectron end-to-end UI
  layer in the repository. Canvas interactions are covered by unit tests of the
  underlying state functions, not by clicking a real window.

## Ordering

The documented gate order is: **typecheck → desktop build → Server build →
release-safety checks → tests**. The builds must precede the test suite because
`src/server/server-boot-gate.test.ts` GETs `/` and asserts the served shell,
which only exists after `pnpm run build`. Running the suite before the build
produces one spurious failure; this is the known gate-order behaviour behind
that single failing test, not flakiness. The full sequence is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Originality screen: methodology and limits

`scripts/check-originality.py` compares this repository's source files against
the tree of the prior project (a BUSL-1.1 fork) and flags identical blocks.

**Method:**

- Scans source files by extension (`.ts`, `.tsx`, `.js`, `.jsx`, `.css`,
  `.mjs`, `.cjs`, `.py`) under `src/`.
- Strips trivial lines (blank lines, punctuation-only lines, lines shorter than
  8 characters) before comparing, so boilerplate does not trigger matches.
- Flags any run of **5 or more consecutive identical non-trivial lines** that
  appears in the same prior-project file, which catches path-renamed copies
  rather than only same-path duplicates.
- Known-benign matches are recorded in the script and reported as reviewed, not
  fatal.

**Limits — what this does not prove:**

- It is a **textual similarity heuristic**, not a legal analysis and not a
  guarantee of originality. It cannot detect paraphrased copying, copied ideas,
  or copied structure expressed with different identifiers.
- It only compares against the prior project's tree; it does not compare against
  any other terminal manager or any other upstream source.
- It requires the prior project's checkout to be present locally; when it is
  absent the script warns and skips, so a "pass" with the prior tree missing
  means nothing.
- It is run locally, and CI does not run it (CI never checks out the prior
  tree). At this snapshot it was run on the maintainer's workstation and
  reported OK.
- The threshold (5 lines) is a judgement call: a copied block below it would
  pass.

Accordingly the project describes itself as an independent implementation
written from scratch, screened for textual similarity against the prior
project — **not** as "100% original". The human responsibility for keeping the
code clean-room is in [AGENTS.md](../AGENTS.md) →
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Honesty statement

This record was produced by the same person who wrote the code and the release
process. It is a self-audit, like the two audits in `docs/`. No external audit
or review backs any claim on this page. Where a number appears, the command
that produced it is listed so it can be reproduced or refuted.
