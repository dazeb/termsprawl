#!/usr/bin/env bash
# scripts/vendor-searxng.sh — build the vendored SearXNG runtime for the app's
# local search sidecar (Phase 14). Output: resources/searxng-runtime/.
#
# Run locally on dev machines and by the release pipeline BEFORE `pnpm run dist`
# so the AppImage carries the runtime. Reproducible: the python-build-standalone
# tarball is checksum-verified and searxng is pinned by commit SHA (git-addressed
# content, immune to tag churn). searxng is NOT on PyPI (the `searxng` PyPI
# project is an unrelated MCP wrapper) — it installs from its GitHub source.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/resources/searxng-runtime"

# --- pins (bump deliberately; verified 2026-08-27) ---
PBS_TAG=20260814
PY_VER=3.12.14
PBS_SHA256=3297691ae34f75fed81ac424e040145fccb0bafe8e581cd5cadbddfa1c0766c0
SEARXNG_COMMIT=9fea41204fdfa7a5cfa15b0ebd12904c520478ce

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

if [[ -d "$OUT/venv" && -f "$OUT/SEARXNG_VERSION" && $FORCE -eq 0 ]]; then
  echo "searxng runtime already vendored at $OUT (--force to rebuild)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> downloading python-build-standalone ${PY_VER}+${PBS_TAG}…"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PY_VER}+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz"
curl -fsSL --retry 3 -o "$TMP/pbs.tar.gz" "$PBS_URL"
echo "$PBS_SHA256  $TMP/pbs.tar.gz" | sha256sum -c -

echo "==> extracting python runtime…"
rm -rf "$OUT"
mkdir -p "$OUT"
tar xzf "$TMP/pbs.tar.gz" -C "$OUT"

echo "==> creating venv…"
"$OUT/python/bin/python3" -m venv "$OUT/venv"
"$OUT/venv/bin/python" -m pip install -q --upgrade pip

echo "==> downloading searxng @ ${SEARXNG_COMMIT:0:8}…"
curl -fsSL --retry 3 -o "$TMP/searxng.tar.gz" "https://codeload.github.com/searxng/searxng/tar.gz/${SEARXNG_COMMIT}"
tar xzf "$TMP/searxng.tar.gz" -C "$TMP"
SRC="$TMP/searxng-${SEARXNG_COMMIT}"
mkdir -p "$OUT/src"
cp -r "$SRC"/. "$OUT/src/"

echo "==> installing searxng + deps (setup.py imports the package at build time; every requirement + build tool must be present first)…"
"$OUT/venv/bin/pip" install -q msgspec pyyaml setuptools wheel typing_extensions
"$OUT/venv/bin/pip" install -q -r "$OUT/src/requirements.txt"
"$OUT/venv/bin/pip" install -q --no-build-isolation "$OUT/src"

echo "==> writing manifest…"
"$OUT/venv/bin/pip" freeze > "$OUT/requirements.lock"
{
  echo "searxng_commit=${SEARXNG_COMMIT}"
  "$OUT/venv/bin/python" -c "from searx import version; print('searxng_version=' + version.VERSION_STRING)"
  "$OUT/venv/bin/python" --version 2>&1 | sed 's/^/python=/'
  echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT/SEARXNG_VERSION"
cp "$OUT/src/LICENSE" "$OUT/LICENSE-SEARXNG.txt"

echo "==> smoke check…"
"$OUT/venv/bin/python" -c "from searx import version; print('searx import ok:', version.VERSION_STRING)"

echo "done: $(du -sh "$OUT" | cut -f1) at $OUT"
