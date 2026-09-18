#!/usr/bin/env bash
# termsprawl-release-site.sh — bump APP_VERSION + deploy the marketing site.
#
# Usage: scripts/release-site.sh <version>
#   <version> e.g. 0.8.4
#
# Bumps termsprawl-web/src/lib/site.ts APP_VERSION, commits, pushes to
# origin (github) + gitea, then runs the web repo's deploy script (builds,
# rsyncs to the hosting box, reloads Caddy). Verifies the live site afterwards.
#
# Run from the APP repo (locates the web repo as a sibling directory) or from
# the web repo itself. Override the location with TERMSPRAWL_WEB.

set -euo pipefail

NEW_VER=""
# Default: the sibling checkout of termsprawl-web next to this repo.
WEB_REPO="${TERMSPRAWL_WEB:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/termsprawl-web}"

if [[ $# -ge 1 ]]; then NEW_VER="$1"; fi
if [[ -z "$NEW_VER" ]]; then
  echo "usage: scripts/release-site.sh <version>" >&2
  exit 2
fi
if ! [[ "$NEW_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must look like 0.8.4: got '$NEW_VER'" >&2
  exit 2
fi

if [[ ! -d "$WEB_REPO" ]]; then
  echo "web repo not found at $WEB_REPO (set TERMSPRAWL_WEB to override)" >&2
  exit 1
fi

echo "==> site release $NEW_VER in $WEB_REPO"
cd "$WEB_REPO"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "!! web repo working tree is not clean — aborting" >&2
  exit 1
fi

echo "==> bumping APP_VERSION to $NEW_VER"
SITE="src/lib/site.ts"
if ! grep -q "APP_VERSION" "$SITE"; then
  echo "!! APP_VERSION not found in $SITE" >&2
  exit 1
fi
node -e "
const fs=require('fs');
const p='$SITE';
const s=fs.readFileSync(p,'utf8');
fs.writeFileSync(p, s.replace(/export const APP_VERSION = '[0-9]+\.[0-9]+\.[0-9]+'/, \"export const APP_VERSION = '$NEW_VER'\"));
"
grep "APP_VERSION" "$SITE"

git add "$SITE"
if git diff --cached --quiet; then
  echo "==> APP_VERSION already at $NEW_VER — resuming deployment"
else
  git commit -m "chore: bump APP_VERSION to $NEW_VER"
fi
git push origin main
git push gitea main

echo "==> deploying the site"
# The web repo owns the deploy script; its host alias and target path are
# operator-specific and live in the maintainer's private configuration.
bash scripts/deploy-hermes-box.sh

echo "==> verifying live site"
PAGE="$(curl -fsS https://termsprawl.com/)"
JS="$(printf '%s' "$PAGE" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 || true)"
if [[ -z "$JS" ]]; then
  echo "!! live site has no application bundle" >&2
  exit 1
fi
BUNDLE="$(curl -fsS "https://termsprawl.com/$JS")"
if ! printf '%s' "$BUNDLE" | grep -E "(^|[^0-9.])${NEW_VER//./\\.}([^0-9.]|$)" >/dev/null; then
  echo "!! live bundle does not contain version $NEW_VER" >&2
  exit 1
fi
echo "   live bundle verified at $NEW_VER"

echo
echo "==> DONE: site live at $NEW_VER"
