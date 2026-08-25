#!/usr/bin/env bash
# Launch the termsprawl renderer in environments where the app can't use its
# normal runtime locations (see the "app won't launch" diagnosis):
#
#   1. The root filesystem is read-only, so $HOME/.config (the app's
#      userDataPath) is not writable -> EROFS on tmux.conf etc.
#   2. chrome-sandbox is not setuid root (the container sets no-new-privileges),
#      so the SUID sandbox aborts the app before any code runs.
#
# This script points HOME/XDG_* at a writable scratch dir inside the project
# (the workspace is on a rw mount) and disables the Chromium SUID sandbox. It
# should be used only for dev/testing in a container or CI -- never ship it as
# the production launcher (production keeps the SUID sandbox).
#
# Usage:
#   scripts/run-dev-nosandbox.sh            # run the already-built app
#   scripts/run-dev-nosandbox.sh --dev      # electron-vite dev with HMR
#   scripts/run-dev-nosandbox.sh --help
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: scripts/run-dev-nosandbox.sh [--dev]"
  echo
  echo "Launches termsprawl from a writable, nosandbox runtime for containers/CI."
  echo "  (no args)  run the built app (pnpm run build first)"
  echo "  --dev      electron-vite dev (renderer HMR)"
  exit 0
fi

# A writable runtime dir. The workspace (/mnt/nvme1) is rw even when the root
# filesystem is ro, so stage HOME/XDG_* here. Defaults to ./.runtime unless
# $TERMSPRAWL_RUNTIME_DIR is set.
RUNTIME_DIR="${TERMSPRAWL_RUNTIME_DIR:-$(pwd)/.runtime}"
mkdir -p "$RUNTIME_DIR/home" "$RUNTIME_DIR/config" "$RUNTIME_DIR/cache"

# Only redirect if the real $(HOME)/.config isn't writable. Detect a writable
# dir without leaving a file behind.
if ! (mkdir -p "$HOME/.config" 2>/dev/null && [ -w "$HOME/.config" ]); then
  export HOME="$RUNTIME_DIR/home"
  export XDG_CONFIG_HOME="$RUNTIME_DIR/config"
  export XDG_CACHE_HOME="$RUNTIME_DIR/cache"
  export XDG_DATA_HOME="$RUNTIME_DIR/data"
  echo "note: \$HOME/$XDG_CONFIG_HOME is not writable; redirecting runtime to:"
  echo "      HOME=$HOME"
  echo "      XDG_CONFIG_HOME=$XDG_CONFIG_HOME"
fi

# The SUID sandbox aborts in containers (no-new-privileges). Disable it for dev.
export ELECTRON_DISABLE_SANDBOX="${ELECTRON_DISABLE_SANDBOX:-1}"

# Resolve the local electron binary (pnpm hoists it next to node_modules).
ELECTRON_BIN="$(node -e "console.log(require('electron'))" 2>/dev/null || echo "electron")"

if [ "${1:-}" = "--dev" ]; then
  echo "running: electron-vite dev (sandbox disabled)"
  exec pnpm run dev
fi

if [ ! -f "out/main/index.js" ]; then
  echo "error: out/main/index.js not found — run 'pnpm run build' first." >&2
  exit 1
fi

echo "running: built app (sandbox disabled)"
exec "$ELECTRON_BIN" out/main/index.js
