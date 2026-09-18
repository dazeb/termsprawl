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
Copy the commands you actually ran and their result. The documented order is:
  pnpm run typecheck
  pnpm run build
  pnpm run build:server
  python3 scripts/release-safety.test.py
  pnpm test
-->

```
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
