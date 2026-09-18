<!--
Thanks for contributing. Keep it focused: one topic per pull request.
See CONTRIBUTING.md for setup and the full gate list.
-->

## What changed

<!-- A short summary of the change and the problem it solves. -->

## Why

<!-- The reasoning, and any alternative you rejected. Link an issue if there is one. -->

Closes #

## How it was verified

<!--
Copy the commands you actually ran and their result. The canonical command is:
  pnpm run verify
(typecheck → desktop build → Server build → release-safety checks → tests).
Plus ./scripts/check-originality.sh if code changed.
-->

```bash
pnpm run verify
```

- [ ] New or changed behaviour has a test (or the PR explains why not)
- [ ] Docs updated in this change if the behaviour is user-visible
- [ ] `./scripts/check-originality.sh` run if code changed
- [ ] No files added under `.github/workflows/` (CI is self-hosted Gitea)

## Notes for the reviewer

<!--
Anything you could not verify, known gaps, screenshots for UI changes, or
follow-up work you deliberately left out. Say so plainly — an honest gap is
better than an unstated one.
-->
