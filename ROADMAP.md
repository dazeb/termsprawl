# Roadmap

This is the public roadmap: what the project intends to work on next and what
it deliberately will not do. It is current as of **2026-09-18** and describes a
pre-1.0 project with a single maintainer, so it changes as capacity and funding
change. `PLAN.md` is the historical implementation record, not this document.

## Current priorities

The shipped baseline is a Linux desktop application (v0.28.0): an infinite
canvas with terminal, editor, browser, sticky, group, and diff nodes; real PTYs
in persistent tmux sessions; agent presets; a git panel; a browser-based Server
Edition; and a standalone encrypted relay service. Current maintenance work
focuses on:

- reliability of the shipped paths — terminal/tmux continuity, project
  persistence, and the release pipeline
- packaging and verification: release artifacts that are reproducible to check
  and easy to verify by hand
- documentation and onboarding for users and contributors
- keeping the public claims in the README, the site, and the docs consistent
  with what actually ships

There are no unsupported delivery dates in this roadmap. Items below are
priorities, not commitments to a date.

## Near-term work

These are the next tasks that are already supported by the project's own plan
and recent work:

- a single canonical verification command that wraps the documented gates, so
  contributors run the same sequence CI does
- release evidence improvements: hashes for published artifacts and release
  notes generated from the tagged commit range
- continuing the honesty pass on capability reporting so a preset never claims
  a feature its CLI cannot deliver
- contributor onboarding material — issue templates, a good-first-issue set,
  and this trust layer kept current

## Funding-dependent work packages

These are the work packages the project would take on with grant funding. They
are the same packages described on the project's funders page
(https://termsprawl.com/funders). No funding has been received for them, and
none of them is in progress today.

### 1. Reliability, packaging, and access

- automated packaging and release checks across more Linux distributions and
  desktop environments
- a public verification record for each release, including what was and was not
  tested
- accessibility remediation with a published before/after audit: keyboard
  paths, focus behaviour, and screen-reader behaviour for the canvas
- documentation and onboarding aimed at new and non-expert users

### 2. Server Edition and secure remote access

- hardening the browser Server Edition for non-localhost deployment
- completing remote project transport over SSH, tested against real hosts
- independent review of the authentication and isolation model before any
  hosted default changes
- a written threat model that matches what is implemented

### 3. Provider-neutral agent interoperability

- a documented, stable interface between the canvas and agent CLIs
- conformance tests for each supported agent preset instead of per-vendor
  special cases
- better context hand-off between linked agents, with explicit user control
- honest capability reporting so a preset never claims a feature it cannot
  deliver

### 4. Onboarding, community, and independent review

- contributor onboarding: a good-first-issue set, contributor documentation,
  and mentor time
- an independent security assessment of the cloud and relay services — none
  has been performed to date; the published audits are maintainer self-audits
- an independent accessibility assessment against WCAG for the canvas
  interface
- governance and succession practised rather than aspirational

## 1.0 readiness criteria

termsprawl will be called 1.0 when, at minimum:

- the on-disk project format and the public interfaces have stopped changing in
  breaking ways between releases
- the documented gates pass consistently on a clean checkout, and release
  artifacts are verifiable by a third party (hashes published with the release)
- the Server Edition's authentication and isolation model has had independent
  review, or is documented as single-user/localhost-only with that boundary
  enforced
- the accessibility gaps identified in the funded audit work are addressed or
  explicitly documented
- governance has more than one maintainer, or the single-maintainer risk is
  stated plainly alongside the archival plan

Passing these criteria is a maintainer judgement documented in a release note,
not an external certification.

## Non-goals

- **No macOS or Windows support.** termsprawl is Linux-only by decision; the
  fork lineage's macOS phone-relay path was dropped deliberately.
- **No proprietary core.** The desktop application, the Server Edition, and the
  relay service stay in the MIT-licensed public repository. Hosted services are
  optional and additive, not a way to hold features back.
- **No artificial delivery dates.** No date is published that the project
  cannot support with the capacity it has.
- **No claims without evidence.** Maturity, security, accessibility, and
  originality statements stay within what the repository can show; self-audits
  are labelled as such.
- **No telemetry-by-default.** The application does not require an account and
  does not phone home for core use.
