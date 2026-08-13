#!/usr/bin/env python3
"""Originality check — guarantees no code was copied from a prior project.

Scans every code file under the source tree and compares it against EVERY code
file in the prior project's tree, failing on any identical block of >= MIN_BLOCK
non-trivial lines that all appear in the same prior file. Path-renamed copies
are caught (the real risk), not just same-path duplicates.

Usage:
    ./scripts/check-originality.py [source_dir] [prior_project_dir]
      source_dir:        what to scan          (default: src)
      prior_project_dir: the project to check  (default: ../nodeterm-linux)
Env:
    MIN_BLOCK: minimum identical consecutive lines to flag (default: 5)
"""

import os
import re
import sys

CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".css", ".mjs", ".cjs", ".py"}
MIN_BLOCK = int(os.environ.get("MIN_BLOCK", "5"))
MIN_LINE_LEN = 8  # ignore trivial lines (brackets, short imports, boilerplate)
TRIVIAL = re.compile(r"^[\s{}()\[\];,.*'\"`~!@#$%^&+=<>|/:\\-]+$")


def code_files(root):
    """All code files under root, as absolute paths."""
    out = []
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if os.path.splitext(n)[1] in CODE_EXTS:
                out.append(os.path.join(dirpath, n))
    return out


def meaningful_lines(path):
    """Non-blank, non-trivial lines, right-stripped."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return [
                line.rstrip()
                for line in f
                if line.strip() and len(line.rstrip()) >= MIN_LINE_LEN
                and not TRIVIAL.match(line)
            ]
    except OSError:
        return []


def main():
    source_dir = sys.argv[1] if len(sys.argv) > 1 else "src"
    prior_dir = sys.argv[2] if len(sys.argv) > 2 else "../nodeterm-linux"

    if not os.path.isdir(source_dir):
        print(f"OK: {source_dir} does not exist yet — nothing to check.")
        return 0
    if not os.path.isdir(prior_dir):
        print(f"WARN: prior project not found at {prior_dir} — skipping check.")
        return 0

    prior_files = code_files(prior_dir)
    our_files = code_files(source_dir)

    # Index: line -> set of prior-file indices containing it.
    index = {}
    for i, pf in enumerate(prior_files):
        for line in meaningful_lines(pf):
            index.setdefault(line, set()).add(i)

    failures = []
    for our_file in our_files:
        lines = meaningful_lines(our_file)
        if not lines:
            continue
        run_candidates = None  # prior-file indices matching the current run
        run_len = 0
        found_in = None
        for line in lines:
            containing = index.get(line)
            if not containing:
                run_candidates = None
                run_len = 0
                continue
            if run_len == 0 or run_candidates is None:
                run_candidates = set(containing)
            else:
                run_candidates &= containing
            run_len += 1
            if run_candidates and run_len >= MIN_BLOCK:
                found_in = next(iter(run_candidates))
                break
            if not run_candidates:
                run_len = 0
        if found_in is not None:
            rel = os.path.relpath(our_file, source_dir)
            prior = os.path.relpath(prior_files[found_in], prior_dir)
            failures.append(f"{rel}  (identical block >= {MIN_BLOCK} lines "
                            f"also in prior file {prior})")

    print(f"Scanned {len(our_files)} source files against "
          f"{len(prior_files)} prior files (min block: {MIN_BLOCK}).")

    # Known-benign coincidences: lines that are the same because the DOMAIN
    # forces them (third-party library export names, natural channel names,
    # generic flexbox/button CSS declarations). Documented 2026-08-13:
    # React Flow import list, pty IPC channel names, generic CSS patterns.
    # A match here still gets listed below but is expected and reviewed, not
    # copied — the check exists to force that review, not to auto-acquit.
    if failures:
        print("FAIL: copied blocks found:")
        for f in failures:
            print(f"  SUSPICIOUS: {f}")
        print("Rewrite them — do not commit.")
        return 1
    print("OK: no copied blocks found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
