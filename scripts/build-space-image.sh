#!/usr/bin/env bash
# Build the ts-space Docker image — the Server Edition packaged for the hosted
# spaces feature (one container per user space).
#
# Usage: scripts/build-space-image.sh [tag]        (default tag: ts-space:latest)
#
# 1) build the app → out/ (renderer + main + server bundles)
# 2) docker build -f Dockerfile.space (see that file for the image layout and
#    why node_modules/shim.js are handled the way they are)
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${1:-ts-space:latest}"

echo "[space-image] building app bundles (out/)…"
pnpm run build
pnpm run build:server

echo "[space-image] docker build → ${TAG}"
docker build -f Dockerfile.space -t "${TAG}" .

echo "[space-image] done: ${TAG}"
