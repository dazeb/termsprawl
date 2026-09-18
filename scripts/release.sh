#!/usr/bin/env bash
# termsprawl-release.sh — automate the desktop release pipeline.
#
# Usage: scripts/release.sh <new-version> [--from <branch>] [--local-dist]
#   <new-version>  e.g. 0.8.4 (no leading "v" — the tag is v<version>)
#   --from <branch>  merge this feature branch into main first (default: none;
#                     expects you're already on main with the work merged)
#   --merge-all      merge every local branch that is ahead of main (all pending)
#   --local-dist     escape hatch: also build + stage + gh-release locally
#                     (the Gitea Actions builder is the canonical publisher)
#
# Default (builder) flow: merge (optional) → bump → gates → push main→3 remotes
# → tag+push. The Gitea Actions `release` job on the builder (the runner host) picks up
# the tag, builds, and publishes to BOTH Gitea and GitHub. Nothing else to do
# but watch the run and verify the release read-back.
# With --local-dist it also: dist → stage artifacts → gh release create →
# verify by read-back (the pre-builder behaviour).
# Aims to be idempotent-ish: fails loudly and stops on any error.
#
# Prereqs (see AGENTS.md + the termsprawl skill): gh authed for
# dazeb/termsprawl, SSH access to origin/gitea/github, pnpm in PATH.

set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NEW_VER=""
SOURCE_BRANCH=""
MERGE_ALL=0
LOCAL_DIST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) SOURCE_BRANCH="$2"; shift 2 ;;
    --merge-all) MERGE_ALL=1; shift ;;
    --local-dist) LOCAL_DIST=1; shift ;;
    --skip-dist) echo "==> --skip-dist is now the default (builder publishes); ignoring"; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) NEW_VER="$1"; shift ;;
  esac
done

if [[ -z "$NEW_VER" ]]; then
  echo "usage: scripts/release.sh <version> [--from <branch> | --merge-all] [--local-dist]" >&2
  echo "  e.g. scripts/release.sh 0.8.4 --from feat/resizable-all-nodes" >&2
  exit 2
fi
if ! [[ "$NEW_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must look like 0.8.4 (no leading v): got '$NEW_VER'" >&2
  exit 2
fi
TAG="v$NEW_VER"

echo "==> termsprawl release $TAG from $(pwd)"

cd "$REPO"

# ---- 0. sanity: clean tree, correct branch ----
if [[ -n "$(git status --porcelain)" ]]; then
  echo "!! working tree is not clean — aborting (commit or stash first)" >&2
  exit 1
fi
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# ---- 1. merge pending work into main ----
if [[ "$MERGE_ALL" -eq 1 ]]; then
  echo "==> merging all local branches ahead of main"
  git checkout main
  git pull --ff-only origin main 2>/dev/null || true
  for br in $(git for-each-ref 'refs/heads/*' --format='%(refname:short)' | grep -v '^main$'); do
    base="$(git merge-base main "$br" 2>/dev/null || true)"
    if [[ -z "$base" ]]; then continue; fi
    if [[ "$(git rev-parse main)" == "$base" && "$(git rev-parse "$br")" != "$(git rev-parse main)" ]]; then
      echo "==> merging $br"
      git merge --ff-only "$br" 2>/dev/null \
        || git merge --no-ff "$br" -m "merge: $br" || { echo "!! merge conflict on $br — resolve by hand" >&2; exit 1; }
    fi
  done
elif [[ -n "$SOURCE_BRANCH" ]]; then
  echo "==> merging $SOURCE_BRANCH into main"
  git checkout main
  git pull --ff-only origin main 2>/dev/null || true
  git merge --ff-only "$SOURCE_BRANCH" 2>/dev/null \
    || git merge --no-ff "$SOURCE_BRANCH" -m "merge: $SOURCE_BRANCH"
elif [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "!! not on main and no --from/--merge-all given — nothing to release" >&2
  exit 1
fi

# ---- 2. bump version ----
echo "==> bumping to $NEW_VER"
node -e "
const fs=require('fs');
const p='package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.version='$NEW_VER';
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
"
# README "Current version:" bump (keep the surrounding text)
sed -i -E "s/Current version: \*\*[0-9]+\.[0-9]+\.[0-9]+\*\*/Current version: **$NEW_VER**/" README.md

# ---- 3. gates ----
# One canonical gate list (scripts/verify.sh via `pnpm run verify`), shared
# with CI — never duplicate the individual steps here. The originality screen
# stays a separate explicit gate: it needs the prior project's tree, which CI
# (and a fresh clone) does not have, and a skip is not a pass.
echo "==> gates"
pnpm run verify
./scripts/check-originality.sh

# ---- 4. commit bump + push main to all 3 remotes ----
echo "==> commit bump + push main"
git add package.json README.md pnpm-lock.yaml 2>/dev/null || git add package.json README.md
# Idempotent rerun: when the bump is already committed (e.g. resuming a release
# that died after its bump landed), there is nothing to commit — don't abort.
if git diff --cached --quiet; then
  echo "==> already at $NEW_VER — nothing to commit (resuming)"
else
  git commit -m "chore: bump to $NEW_VER"
fi
git push origin main
git push gitea main
git push github main

# ---- 5. tag + push to all remotes (triggers the builder) ----
echo "==> tag $TAG"
if git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  if [[ "$(git rev-parse "$TAG^{commit}")" != "$(git rev-parse HEAD)" ]]; then
    echo "!! $TAG already points to a different commit — aborting" >&2
    exit 1
  fi
  echo "==> reusing existing $TAG at HEAD"
else
  # Annotated tag: the object records tagger, date, and message, so the release
  # record is inspectable offline (`git cat-file -t` says "tag", not "commit").
  git tag -a "$TAG" -m "termsprawl $TAG"
fi
git push origin "$TAG"
git push gitea "$TAG"
git push github "$TAG"

# ---- 6. dist + stage + publish (only with the explicit --local-dist hatch) ----
# Default flow ends at the tag: the Gitea Actions builder (the runner host) picks up the
# tag push and publishes to Gitea + GitHub itself.
if [[ "$LOCAL_DIST" -eq 1 ]]; then
  echo "==> --local-dist: pnpm run dist (local build; AppImageLauncher danger)"
  pnpm run dist

  STAGE="/tmp/termsprawl-release-$NEW_VER"
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  if [[ -f "dist/termsprawl-$NEW_VER.AppImage" ]]; then
    cp "dist/termsprawl-$NEW_VER.AppImage" "$STAGE/"
    cp "dist/termsprawl_${NEW_VER}_amd64.deb" "$STAGE/" 2>/dev/null || true
    cp dist/latest-linux.yml "$STAGE/" 2>/dev/null || true
  else
    echo "!! dist/termsprawl-$NEW_VER.AppImage not found (did dist run?)" >&2
    exit 1
  fi

  # ---- 6. release notes (from CHANGELOG.md) + checksums over the artifacts ----
  # The notes helper refuses an empty CHANGELOG.md section and emits an
  # explicit fallback when the version has no entry. The checksum script gates
  # on the primary artifacts existing and writes dist/SHA256SUMS.
  echo "==> release notes + checksums"
  node scripts/release-notes.mjs "$NEW_VER" > dist/RELEASE_NOTES.md
  bash scripts/release-checksums.sh dist "$NEW_VER"
  cp dist/RELEASE_NOTES.md dist/SHA256SUMS "$STAGE/"
  echo "==> artifacts staged in $STAGE:"
  ls -la "$STAGE"

  # ---- 7. create + verify GitHub release ----
  echo "==> gh release create $TAG"
  if ! gh release create "$TAG" --repo dazeb/termsprawl \
    --title "v$NEW_VER" \
    --notes-file dist/RELEASE_NOTES.md \
    "$STAGE/termsprawl-$NEW_VER.AppImage" \
    "$STAGE/termsprawl_${NEW_VER}_amd64.deb" \
    "$STAGE/latest-linux.yml" \
    "$STAGE/SHA256SUMS" \
    "$STAGE/RELEASE_NOTES.md"; then
    # Idempotent retry: the release already exists — refresh the notes and
    # re-upload the assets instead of aborting the resumed release.
    echo "==> release exists — editing notes + re-uploading assets"
    gh release edit "$TAG" --repo dazeb/termsprawl --notes-file dist/RELEASE_NOTES.md
    gh release upload "$TAG" --repo dazeb/termsprawl --clobber \
      "$STAGE/termsprawl-$NEW_VER.AppImage" \
      "$STAGE/termsprawl_${NEW_VER}_amd64.deb" \
      "$STAGE/latest-linux.yml" \
      "$STAGE/SHA256SUMS" \
      "$STAGE/RELEASE_NOTES.md"
  fi
  echo "==> verifying"
  gh release view "$TAG" --repo dazeb/termsprawl --json tagName,assets \
    --jq '{tag: .tagName, assets: [.assets[].name]}'
else
  echo "==> builder flow: tag pushed — the Gitea Actions release job builds +"
  echo "    publishes to Gitea and GitHub. Watch it, then verify the read-back:"
  echo "    gh release view $TAG --repo dazeb/termsprawl --json tagName,assets --jq '{tag: .tagName, assets: [.assets[].name]}'"
fi

echo
echo "==> DONE: termsprawl $TAG. Next: bump + deploy the web site"
echo "    (scripts/release-site.sh $NEW_VER)"
