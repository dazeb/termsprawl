#!/usr/bin/env bash
# Originality check — thin wrapper around the Python implementation.
# See check-originality.py for usage and semantics.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/check-originality.py" "$@"
