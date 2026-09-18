#!/usr/bin/env bash
# Canonical verification gate for termsprawl.
#
# Usage: pnpm run verify   (equivalently: bash scripts/verify.sh)
#
# Runs the documented gates in their required order. The order is load-bearing:
# src/server/server-boot-gate.test.ts GETs '/' and asserts the served renderer
# shell, which only exists after `pnpm run build`, so both builds must precede
# the vitest suite on a fresh checkout. CI (.gitea/workflows/ci.yml) and
# scripts/release.sh both call this script. This file is the ONE executable
# gate list — extend it here and never add gate steps to the CI workflow or
# release script. The documents that describe the gates (AGENTS.md,
# CONTRIBUTING.md, .github/PULL_REQUEST_TEMPLATE.md, docs/PROJECT-HEALTH.md,
# docs/VERIFICATION.md) mirror this list; scripts/trust-surface.test.ts fails
# unless each mirror matches, so update them in the same change.
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
