# Changelog

All notable changes to termsprawl are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with the pre-1.0 qualification below.

## Pre-1.0 versioning

termsprawl is pre-1.0 (0.y.z). Per Semantic Versioning, the public interfaces
are not frozen: breaking changes may ship in a minor release (`0.28` → `0.29`),
and users should expect the on-disk project format and internal APIs to evolve
between releases. Patch releases are bug fixes and small corrections.

Releases in this repository are cut from `main` after the documented gates
pass; released artifacts are on the
[Releases page](https://github.com/dazeb/termsprawl/releases), and tags exist for
every published version. Earlier release history (roughly 0.2–0.25.7, recorded
sporadically) is in [PLAN.md](PLAN.md), which was the working implementation
record at the time; this file is maintained from 0.26.0 onward.

## [Unreleased]

Nothing yet.

## [0.28.0] — 2026-09-18

### Added

- OpenCode agent preset: canvas node, monochrome logo, dependency setup
  entry, and connections/setup UI wiring, so OpenCode launches as a terminal
  preset like the other supported agent CLIs.

### Fixed

- Dependency setup handling for the new preset so an unverified mechanism
  reports "needs setup" instead of claiming success.

## [0.27.0] — 2026-09-17

### Added

- Rotating 4D tesseract boot screen: 16 vertices rotated in the XW and YW
  planes, projected 4D → 3D → 2D with per-edge depth shading; rendered as an
  overlay that cross-fades over the canvas.
- Agent workspace tools: agents launched by termsprawl receive a shared,
  Electron-free operation service with two clients (a stdio MCP bridge and
  the bundled `termsprawlctl` helper), so one implementation serves every
  preset. Launch preparation picks an adapter from the executable's
  advertised capabilities, and unverified mechanisms report "needs setup".

### Fixed

- Browser node fill: the shipped 0.26.0 build painted only the guest's top
  150px of an enlarged browser node, leaving the rest black. The fix
  (`display: flex` on the webview host) had been authored after the v0.26.0
  tag and was first released here; the released AppImage was extracted and
  verified to contain it.

## [0.26.0] — 2026-09-16

### Added

- Automatic agent launch: agent presets start their CLI as the tmux pane
  process instead of sending startup keystrokes before attach, and warm
  reattachment preserves a running agent. SSH presets resolve on the remote
  host.
- Direct canvas actions: enabled agents appear as direct actions with
  monochrome logos, grouped above creation tools and selection actions, with
  keyboard navigation and viewport clamping.
- Shared browser sessions: sandboxed sign-in popups use the canvas browser
  profile, and authenticated agent cookie read/write/clear commands operate on
  that same profile. New browser nodes open at 1000×720 with no resize
  maximum.

### Fixed

- Release publishing is gated and retries are safe: the release job requires a
  successful verification job, configured credentials, and non-empty artifacts;
  the version bump commit is idempotent on resume.

[Unreleased]: https://github.com/dazeb/termsprawl/compare/v0.28.0...HEAD
[0.28.0]: https://github.com/dazeb/termsprawl/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/dazeb/termsprawl/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/dazeb/termsprawl/releases/tag/v0.26.0
