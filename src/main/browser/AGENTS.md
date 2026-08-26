# AGENTS.md — src/main/browser

Electron main-process browser-node infrastructure (Phase 13). The embedded
browser node is a sandboxed `<webview>` guest rendered inline on the canvas; the
two concerns guarded here are SECURITY and the CDP surface an external agent
uses to drive it.

## Contents

- `runtime.ts` — provisions the one per-session CDP endpoint (random high port,
  48-hex token, localhost only). `ensureBrowserDebugPort()` puts
  `--remote-debugging-port` on the real argv (the reliable path) — via the
  Wayland respawn in `../index.ts`, or appendSwitch on native X11 — and
  reconciles `browser:cdp-info` to any port a user/agent passes manually.
- `manager.ts` — `installBrowserSecurity()` hardens every `<webview>` guest at
  attach (strip preload, force contextIsolation + sandbox, `webSecurity` on),
  blocks non-web `will-navigate`/`will-redirect`, denies all popups, and keeps a
  node-id → guest-id map so `navigateBrowserNode()` can drive a node by its
  stable canvas id while enforcing the URL policy in one place.
- `agent-server.ts` — loopback, token-gated agent-control server: `GET /info`,
  `POST /open` (URL validated by core/browser-policy), discovery file
  `userData/browser-agent.json`. State-changing only; never open.
- `cdp-facade.ts` — "virtual browser" on its own loopback port that re-exposes
  every live guest as a standard `page` target so Playwright's `connectOverCDP`
  (and Puppeteer) can drive the exact page the user watches. See the big header
  comment: it implements Playwright's auto-attach model and — critically —
  reports each guest's REAL target id (== its main frame id, learned from the
  guest's own `Page.getFrameTree` at attach), because Playwright resolves frame
  sessions by that id and silently degrades the page to a dummy frame on
  mismatch.

## Rules

- The guest must NEVER carry a preload or Node — a page inside the browser can
  reach neither `window.termsprawl` nor Node.
- The URL policy lives in `src/core/browser-policy.ts` (pure, electron-free,
  TDD). Do not inline navigation checks here — import that.
- The CDP endpoint binds to 127.0.0.1 only. Do not loosen to 0.0.0.0.

See ../../AGENTS.md for the process model.
