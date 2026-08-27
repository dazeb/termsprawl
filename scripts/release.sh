#!/usr/bin/env bash
# termsprawl-release.sh — automate the full desktop release pipeline.
#
# Usage: scripts/release.sh <new-version> [--from <branch>] [--skip-dist]
#   <new-version>  e.g. 0.8.4 (no leading "v" — the tag is v<version>)
#   --from <branch>  merge this feature branch into main first (default: none;
#                     expects you're already on main with the work merged)
#   --merge-all      merge every local branch that is ahead of main (all pending)
#
# Runs: merge (optional) → bump → gates → push main→3 remotes → dist →
# stage artifacts → tag+push → gh release create → verify by read-back.
# Aims to be idempotent-ish: fails loudly and stops on any error.
#
# Prereqs (see AGENTS.md + the termsprawl skill): gh authed for
# dazeb/termsprawl, SSH access to origin/gitea/github, pnpm in PATH.

set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NEW_VER=""
SOURCE_BRANCH=""
MERGE_ALL=0
SKIP_DIST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) SOURCE_BRANCH="$2"; shift 2 ;;
    --merge-all) MERGE_ALL=1; shift ;;
    --skip-dist) SKIP_DIST=1; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) NEW_VER="$1"; shift ;;
  esac
done

if [[ -z "$NEW_VER" ]]; then
  echo "usage: scripts/release.sh <version> [--from <branch> | --merge-all] [--skip-dist]" >&2
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
echo "==> gates"
pnpm run typecheck
pnpm test
./scripts/check-originality.sh

# ---- 4. commit bump + push main to all 3 remotes ----
echo "==> commit bump + push main"
git add package.json README.md pnpm-lock.yaml 2>/dev/null || git add package.json README.md
git commit -m "chore: bump to $NEW_VER"
git push origin main
git push gitea main
git push github main

# ---- 5. dist ----
if [[ "$SKIP_DIST" -eq 1 ]]; then
  echo "==> --skip-dist: skipping pnpm run dist"
else
  # Vendored SearXNG runtime must be present for the AppImage (14.x).
  echo "==> vendor searxng runtime"
  bash scripts/vendor-searxng.sh
  echo "==> pnpm run dist"
  pnpm run dist
fi

# ---- 6. stage artifacts immediately (AppImageLauncher danger) ----
STAGE="/tmp/termsprawl-release-$NEW_VER"
rm -rf "$STAGE"; mkdir -p "$STAGE"
if [[ -f "dist/termsprawl-$NEW_VER.AppImage" ]]; then
  cp "dist/termsprawl-$NEW_VER.AppImage" "$STAGE/"
  cp "dist/termsprawl_${NEW_VER}_amd64.deb" "$STAGE/" 2>/dev/null || true
  cp dist/latest-linux.yml "$STAGE/" 2>/dev/null || true
  echo "==> artifacts staged in $STAGE:"
  ls -la "$STAGE"
else
  echo "!! dist/termsprawl-$NEW_VER.AppImage not found (did dist run?)" >&2
  exit 1
fi

# ---- 7. tag + push to all remotes ----
echo "==> tag $TAG"
git tag "$TAG"
git push origin "$TAG"
git push gitea "$TAG"
git push github "$TAG"

# ---- 8. write release notes (changelog from commit subjects) ----
NOTES="$STAGE/RELEASE_NOTES.md"
{
  echo "# termsprawl $NEW_VER"
  echo
  echo "## Changelog"
  git log --oneline "$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo v0.0.0)..$TAG" | sed 's/^/- /'
  echo
  echo "## Install"
  echo "Download the AppImage or .deb from the [Releases](https://github.com/dazeb/termsprawl/releases/tag/$TAG) page."
} > "$NOTES"
echo "==> wrote $NOTES"

# ---- 9. create + verify GitHub release ----
echo "==> gh release create $TAG"
gh release create "$TAG" --repo dazeb/termsprawl \
  --title "v$NEW_VER" \
  --notes-file "$NOTES" \
  "$STAGE/termsprawl-$NEW_VER.AppImage" \
  "$STAGE/termsprawl_${NEW_VER}_amd64.deb" \
  "$STAGE/latest-linux.yml"
echo "==> verifying"
gh release view "$TAG" --repo dazeb/termsprawl --json tagName,assets \
  --jq '{tag: .tagName, assets: [.assets[].name]}'

echo
echo "==> DONE: termsprawl $TAG released. Next: bump + deploy the web site"
echo "    (scripts/release-site.sh $NEW_VER)"
