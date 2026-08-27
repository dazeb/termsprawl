#!/usr/bin/env bash
# termsprawl-release-site.sh — bump APP_VERSION + deploy the marketing site.
#
# Usage: scripts/release-site.sh <version>
#   <version> e.g. 0.8.4
#
# Bumps termsprawl-web/src/lib/site.ts APP_VERSION, commits, pushes to
# origin (github) + gitea, then runs scripts/deploy-hermes-box.sh (builds,
# rsyncs to hermes-box, reloads Caddy). Verifies the live site afterwards.
#
# Run from the APP repo (locates the web repo via a sibling path) or from the
# web repo itself.

set -euo pipefail

NEW_VER=""
WEB_REPO="${TERMSPRAWL_WEB:-/home/dazeb/workspace/projects/termsprawl-web}"

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
git commit -m "chore: bump APP_VERSION to $NEW_VER"
git push origin main
git push gitea main

echo "==> deploying to hermes-box"
bash scripts/deploy-hermes-box.sh

echo "==> verifying live site"
set +e
STATUS="$(curl -s -o /dev/null -w '%{http_code}' https://termsprawl.com/)"
JS="$(curl -s https://termsprawl.com/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
VERSIONS="$(curl -s "https://termsprawl.com/$JS" | grep -oE "$(echo "$NEW_VER" | sed -E 's/\./\\./g')" | sort | uniq -c)"
set -e
echo "   HTTP $STATUS"
echo "   bundle carries $NEW_VER: ${VERSIONS:-0}"

echo
echo "==> DONE: site live at $NEW_VER"
