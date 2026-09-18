# AGENTS.md — docs

Specification, evidence, and reference docs for termsprawl. Not generated —
hand-edited.

## Contents

- `FEATURES.md` — the feature spec (canvas, terminals, projects, agents, chat,
  source control, remote, Server Edition, extras). Marked **[own]** = concepts
  we originated; they are rebuilt from scratch, never copied.
- `OWN-WORK.md` — concept reference for features we originated in the prior
  project (Telegram bot, relay, chat driver). Consult when designing v2
  rebuilds; never port files.
- `PROJECT-HEALTH.md` — one-page project state for reviewers: verification
  snapshot, maintenance position, self-audit provenance, CI/supply-chain
  posture (including what is NOT claimed), known limitations.
- `VERIFICATION.md` — the dated verification record: exact commands and
  results, what was skipped, what was not run, the similarity screen's
  methodology and limits.
- `AUDIT-2026-08-29.md`, `AUDIT-2026-09-13.md` — **maintainer self-audits**.
  Never describe them as independent audits.
- `SPACES-OPS.md` — operating the hosted preview services. Uses role-based
  host placeholders; operator-specific values (hosts, IPs, container IDs, key
  paths, secrets) live in private infrastructure configuration, never here.
- `media/` — repository-owned images referenced by public docs (for example
  the README screenshot).

## Rules

- Docs text is part of the clean-room rule: never copy prose from other
  projects.
- Keep FEATURES.md aligned with what PLAN.md promises — PLAN.md is the
  historical implementation record, FEATURES.md is the target spec.
- Public trust documents live at the repository root (SECURITY.md,
  CONTRIBUTING.md, GOVERNANCE.md, ROADMAP.md, FUNDING.md, CHANGELOG.md) and
  must stay consistent with this directory. `scripts/trust-surface.test.ts`
  guards their existence, key wording, and links — run `pnpm test
  scripts/trust-surface.test.ts` after editing any of them.
- Honesty rules for anything published here: state the maturity as pre-1.0 ·
  actively maintained; describe the published audits as maintainer self-audits;
  claim no revenue, customers, independent review, accessibility conformance,
  or signed/SBOM/provenance supply-chain coverage unless it exists; describe
  the originality screen as a heuristic, not a legal guarantee.
- Never record private infrastructure details (IP addresses, container IDs,
  SSH key paths, chat IDs) in this directory or any tracked file.

See ../AGENTS.md for repo-wide conventions and legal rules.
