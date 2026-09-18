#!/usr/bin/env bash
# Canonical verification gate for termsprawl.
#
# Usage: pnpm run verify   (equivalently: bash scripts/verify.sh)
#
# Runs the documented gates in their required order. The order is load-bearing:
# src/server/server-boot-gate.test.ts GETs '/' and asserts the served renderer
# shell, which only exists after `pnpm run build`, so both builds must precede
# the vitest suite on a fresh checkout. CI (.gitea/workflows/ci.yml) and
# scripts/release.sh both call this script — do not duplicate the gate list
# anywhere else; extend this file instead.
#
# Not part of `verify` on purpose: ./scripts/check-originality.sh and the
# manual space/GitHub-import E2Es need an environment CI does not have (the
# prior project's tree, Docker, a real git-host token). They stay separate,
# explicit gates — see CONTRIBUTING.md and AGENTS.md.
set -euo pipefail

cd "$(dirname -- "${BASH_SOURCE[0]}")/.."

echo "==> verify: typecheck"
pnpm run typecheck

echo "==> verify: build (desktop)"
pnpm run build

echo "==> verify: build (Server Edition)"
pnpm run build:server

echo "==> verify: release safety checks"
python3 scripts/release-safety.test.py

echo "==> verify: test suite"
pnpm test

echo "==> verify: all gates passed"
