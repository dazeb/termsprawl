# Funding

termsprawl is a pre-1.0, Linux-only desktop application, MIT-licensed and free
to use. It is maintained by one person, Darren Bennett (`daz@dazeb.dev`).

## Current status: no funding, no revenue

The project has **no revenue, no paying customers, and no grant funding at this
time**. It is not backed by a company, foundation, fiscal sponsor, or grant
programme. Any statement to the contrary would be inaccurate.

The optional hosted services (encrypted backup and hosted canvas spaces) are
**preview-stage with test-mode billing**. They have not demonstrated revenue:
no customer has paid for them, and their pricing and quotas are not final.
They exist so the commercial path can be evaluated, not as a business that is
currently operating.

The desktop application is, and will remain, open source under MIT — including
the Server Edition and the relay service. Hosted services are additive; the
desktop app works offline with no account.

## What funding would pay for

Grant funding would underwrite work that has no direct revenue path. The work
packages are listed on the project's funders page
(https://termsprawl.com/funders) and mirrored in [ROADMAP.md](ROADMAP.md):

1. **Reliability, packaging, and access** — packaging and release checks across
   more Linux distributions, a public verification record per release,
   accessibility remediation with a published before/after audit, and
   documentation aimed at new users.
2. **Server Edition and secure remote access** — hardening the browser server
   for non-localhost deployment, completing SSH remote transport, an
   independent review of the authentication and isolation model, and a written
   threat model.
3. **Provider-neutral agent interoperability** — a documented interface between
   the canvas and agent CLIs, conformance tests per preset, and honest
   capability reporting.
4. **Onboarding, community, and independent review** — a good-first-issue set
   and contributor documentation, an independent security assessment of the
   cloud and relay services, and an independent accessibility assessment
   against WCAG.

No fixed ask or budget is published here. A programme that needs a budget
breakdown, milestone plan, or letters of support can request one by email — the
numbers depend on the programme's scope and format.

## Reporting and open output

- Every funded work package lands in this public repository under the MIT
  license. There is no separately licensed deliverable.
- Progress is reported against the outputs above, with links to merged code,
  published audits, and release artifacts.
- Verification is reported honestly, including gates that were skipped and
  tests that are opt-in. See [docs/VERIFICATION.md](docs/VERIFICATION.md).
- Findings from independent reviews would be published with remediation status,
  not summarized as assurances. No independent review has been performed to
  date; the published audits are maintainer self-audits.
- Where a funder requires private reporting, that requirement is negotiated in
  advance and stated in the funding agreement. The default is public.

## How to help without money

- Contribute code, tests, docs, or translations — see
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Report bugs and usability problems through the issue templates.
- Report security issues privately through
  [SECURITY.md](SECURITY.md).
- Review the grant-readiness evidence and point out anything that looks
  overstated: [docs/PROJECT-HEALTH.md](docs/PROJECT-HEALTH.md),
  [docs/VERIFICATION.md](docs/VERIFICATION.md), and the two maintainer
  self-audits (`docs/AUDIT-2026-08-29.md`, `docs/AUDIT-2026-09-13.md`).

## Contact

Darren Bennett · `daz@dazeb.dev`

There is deliberately no `.github/FUNDING.yml` and no donation link: the
project has no funding destination configured, and publishing a button without
one would be misleading. If that changes, this file and the repository
configuration are updated together.
