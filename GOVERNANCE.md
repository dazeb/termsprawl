# Governance

termsprawl is a pre-1.0, Linux-only, MIT-licensed project. It is not backed by
a company, a foundation, or any sponsoring organisation, and it has no
community voting process. This document describes how decisions are actually
made today, so contributors know what to expect.

## Roles

**Sole maintainer:** Darren Bennett — `daz@dazeb.dev`. The maintainer is the
final decision maker for merges, releases, and repository administration, and
is the only person with write access to the release pipeline.

**Contributors:** anyone who opens an issue or pull request, reports a bug,
improves documentation, or reviews a change. Contributors do not need any
formal status to participate.

## How decisions are made

- Routine changes (bug fixes, small features, docs) are decided in the pull
  request that proposes them. Review comments and the merge decision are the
  record.
- Significant or contentious changes — new node kinds, on-disk format changes,
  security model changes, anything that alters the project's public claims —
  are first described in an issue or a design note under `docs/` so the
  reasoning is public. The maintainer makes the call, and states the rationale
  in that thread, including when a proposal is declined.
- Where practical, decisions are documented in the repository: this file, the
  roadmap, `PLAN.md` (the historical implementation record), or the issue/PR
  thread itself.
- There is deliberately no voting mechanism. A single maintainer cannot
  delegate accountability to a vote; contributors are heard through review,
  and the reasoning for a decision is expected to be visible.

## Path to becoming a maintainer

There is no formal application. The path is sustained contribution:

1. Land several focused changes over time and take part in review.
2. Show judgement consistent with the project rules — honest capability
   reporting, no unsupported claims, clean-room discipline, tests with
   changes.
3. The current maintainer invites a contributor to take on maintainer
   responsibilities (triage, review, release duties) — or the contributor asks
   and it is discussed in the open.

When another maintainer is added, this file is updated with their name and
scope, and the release keys/tokens are transferred or shared. Until that
happens, treat every statement about "the maintainer" as singular.

## Conflict handling

- Technical disagreement: keep discussing in the issue or PR thread. If it
  cannot be resolved, the maintainer decides and records the reasoning. A
  declined PR can always be forked under the MIT license.
- Interpersonal conduct: handled under [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
  with the enforcement contact `daz@dazeb.dev`. Reports about the maintainer
  go to the same address; the expectation is a fair review and a public
  correction where one is warranted.
- Security matters are an explicit exception to the "decide in public" rule:
  a report may be investigated and fixed privately until an advisory is
  published, as described in [SECURITY.md](SECURITY.md).

## Releases

Only the maintainer publishes releases. Releases are cut from `main` after the
documented gates pass; the current release line is the only supported line
(pre-1.0). Release notes are generated from the tagged commit range, and
verification evidence is recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Succession and archival

The project currently has no successor. The intent, if the maintainer can no
longer continue:

1. Offer maintainership to a sustained contributor who already knows the
   project, transferring the release pipeline with the role.
2. If no successor takes over, the repository is archived, and a clear notice
   is added to the README and this file stating that the project is unmaintained.
   Archival does not change the license: the code remains MIT, and forks remain
   permitted and encouraged.
3. Any hosted preview services would be shut down; the desktop application does
   not depend on them to function, so local data keeps working.

This is an intention, not a guarantee, and it is documented here so reviewers
and users can see the plan rather than assume one exists.

## Changing this document

Governance changes are made by pull request or direct commit by the maintainer
and are recorded in the repository history. There is no external approval body.
