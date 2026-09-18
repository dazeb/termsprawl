#!/usr/bin/env bash
# Generate dist/SHA256SUMS over the published release artifacts.
#
# Usage: scripts/release-checksums.sh <dist-dir> <version>
#   <dist-dir>  directory holding the built artifacts (dist/)
#   <version>   e.g. 0.29.0 (no leading "v")
#
# Writes <dist-dir>/SHA256SUMS with one "sha256  filename" line per artifact,
# in a fixed order, so the same artifacts always produce the same file.
# Verifying a download: cd into the directory holding the artifacts and run
# `sha256sum -c SHA256SUMS`.
#
# The primary artifacts must already exist and be non-empty — this script is
# the gate, so a missing or empty AppImage/.deb/updater manifest fails loudly
# instead of publishing an incomplete release.
set -euo pipefail

DIST_DIR="${1:?usage: release-checksums.sh <dist-dir> <version>}"
VERSION="${2:?usage: release-checksums.sh <dist-dir> <version>}"

ARTIFACTS=(
  "termsprawl-${VERSION}.AppImage"
  "termsprawl_${VERSION}_amd64.deb"
  "latest-linux.yml"
)

for name in "${ARTIFACTS[@]}"; do
  if [[ ! -s "$DIST_DIR/$name" ]]; then
    echo "!! missing or empty release artifact: $DIST_DIR/$name" >&2
    exit 1
  fi
done

(
  cd "$DIST_DIR"
  # LC_ALL=C keeps the ordering locale-independent; sha256sum prints
  # "<digest>  <name>" with two spaces, which `sha256sum -c` expects.
  LC_ALL=C sha256sum "${ARTIFACTS[@]}" > SHA256SUMS
)

echo "==> wrote $DIST_DIR/SHA256SUMS"
cat "$DIST_DIR/SHA256SUMS"
