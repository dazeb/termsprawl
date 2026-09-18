# Project health

**Snapshot date:** 2026-09-18 · **Commit:**
`ebc5f66139ec3161653a84fc9e1044c61f557921` · **Release:** v0.28.0
**Maturity:** pre-1.0 · actively maintained · **Maintainer:** Darren Bennett
(sole maintainer) · **Platform:** Linux

This page summarises the state of the project for reviewers: what was verified,
what was not, what is known to be weak, and where the supporting evidence lives.
It is deliberately narrower than a marketing page. Everything here is either a
command result recorded in [VERIFICATION.md](VERIFICATION.md) or a linked
document in this repository.

## What the project is

An MIT-licensed Linux desktop application (Electron + React + tmux) that places
real terminals, editors, browsers, and agent sessions as nodes on an infinite
canvas. A browser-based Server Edition and a standalone encrypted relay service
live in the same repository. There is no proprietary core and no paid tier
inside the desktop app.

## Verification at this snapshot

Recorded on the commit above, after the declared builds:

| Gate | Result |
|---|---|
| `pnpm run typecheck` | passed (node + web TypeScript projects) |
| `pnpm run build` | passed (desktop production build) |
| `pnpm run build:server` | passed (Server Edition bundle) |
| `pnpm test` | 1,112 passed, 1 skipped |
| `python3 scripts/release-safety.test.py` | passed (offline release failure paths) |

A fresh run on the branch that carries this page reports 1,165 passed and the
same single skip: the 53-test trust-surface policy test below runs in the
normal suite (1,112 + 53). See the delta note in
[VERIFICATION.md](VERIFICATION.md).

The single skip is the opt-in live installer smoke test
(`src/core/dependency-install.smoke.test.ts`), which downloads real agent
distributions and only runs when `TERMSPRAWL_INSTALL_SMOKE=1` is set. It is
skipped by design in the normal suite. Full detail, including test categories
and the gates that were **not** run for this snapshot, is in
[VERIFICATION.md](VERIFICATION.md).

## Maintenance position

- **One maintainer.** Darren Bennett is the sole maintainer with merge and
  release authority; there is no company, foundation, board, or fiscal sponsor
  behind the project. The decision process, the path for sustained contributors
  to become maintainers, and the succession/archival intent are documented in
  [GOVERNANCE.md](../GOVERNANCE.md). The single-maintainer risk is real and is
  stated rather than hidden.
- **Linux only.** No macOS or Windows support, by decision.
- **Pre-1.0.** The on-disk project format and internal interfaces can change
  between releases. The current release line (0.28.x) is the only supported
  line. See [SECURITY.md](../SECURITY.md) and [ROADMAP.md](../ROADMAP.md).
- **Bus factor.** The codebase is documented (AGENTS.md, PLAN.md, docs/) so a
  new contributor can pick it up, but no second maintainer exists today.

## Published self-audits

Two audits are published in this repository. Both are **maintainer
self-audits** — the same person wrote the code and the audit. They are not
independent reviews, and they are not a substitute for one:

- [AUDIT-2026-08-29.md](AUDIT-2026-08-29.md) — full audit of frontend, backend,
  and infrastructure against `main` @ `253f74f` (v0.11.0), 580 tests green.
  Findings were remediated; the 2026-09-13 audit tracks the closeout.
- [AUDIT-2026-09-13.md](AUDIT-2026-09-13.md) — completion audit and closeout
  plan at `main` @ `6d77815` (v0.25.0), including which prior claims were
  stale.

**No independent security assessment, accessibility assessment, or code review
by a third party has been performed.** The project states this plainly because
grant reviewers and users need the boundary to be visible. Both audits and this
snapshot are self-assessed.

## CI visibility and supply-chain posture

- CI runs on a **self-hosted Gitea runner** (`.gitea/workflows/ci.yml`), not on
  GitHub. GitHub Actions are disabled for this project's GitHub account by
  choice, and no `.github/workflows` directory exists. **CI results are
  therefore not publicly visible**; the workflow definition is public, and
  verification results are published in [VERIFICATION.md](VERIFICATION.md).
- There is **no public code-scanning coverage** (no CodeQL or equivalent),
  **no published SBOM**, **no signed releases** (artifacts are not code-signed,
  and releases are not signed with a project key or attestation), and **no
  build-provenance attestation** (no SLSA-style provenance or reproducible-build
  attestation). Do not read the presence of `latest-linux.yml` as release
  signing: it is the auto-update feed, not a signature.
- Dependency versions are pinned by `pnpm-lock.yaml`; `pnpm-workspace.yaml`
  records version overrides. [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)
  lists bundled dependencies and licenses.
- The clean-room originality screen is an automated heuristic. Its methodology
  and limits are documented in [VERIFICATION.md](VERIFICATION.md); it is not a
  legal guarantee, and the project does not claim 100% originality.

## Accessibility

No accessibility conformance claim is made. The UI has some deliberate
accessibility work (a global focus-visible ring, reduced-motion handling,
ARIA live regions in the transcript, and contrast-checked chat text), but there
has been no WCAG audit, no screen-reader testing programme, and no published
conformance statement. An independent accessibility assessment is an explicit
funding-dependent work package in [ROADMAP.md](../ROADMAP.md).

## Known limitations

- **Single maintainer** — the primary sustainability risk; see above.
- **Pre-1.0 interfaces** — project files and internal APIs change between minor
  releases.
- **No independent assessment** — security, accessibility, and originality
  claims rest on self-review and automated screens.
- **CI is private** — the runner is self-hosted and its results are not public;
  the workflow file is, and results are republished here.
- **No signed binaries or provenance** — download integrity relies on HTTPS and
  GitHub Releases; hashes are not yet published with each release.
- **Hosted services are preview-stage** with test-mode billing and quotas that
  are not final; they are not sold as hardened multi-tenant infrastructure.
- **Agent integrations vary by vendor** — capability reporting is deliberately
  conservative because hooks exist for some CLIs and not others; the UI reports
  "needs setup" rather than claiming support it cannot verify.
- **Bundle size** — the renderer is large; a bundle-size/perf pass is on the
  roadmap, not done.

## Evidence index

- [docs/VERIFICATION.md](VERIFICATION.md) — the dated verification record
- [docs/AUDIT-2026-08-29.md](AUDIT-2026-08-29.md),
  [docs/AUDIT-2026-09-13.md](AUDIT-2026-09-13.md) — maintainer self-audits
- [scripts/trust-surface.test.ts](../scripts/trust-surface.test.ts) — the test
  that keeps this trust layer (files, wording, links, metadata) intact
- [scripts/check-originality.py](../scripts/check-originality.py) — the
  automated similarity screen
- [CHANGELOG.md](../CHANGELOG.md) — release history
- https://github.com/dazeb/termsprawl/releases — published artifacts
