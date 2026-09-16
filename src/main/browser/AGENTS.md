# AGENTS.md — src/main/browser

Electron main-process browser-node infrastructure (Phase 13). The embedded
browser node is a sandboxed `<webview>` guest rendered inline on the canvas; the
two concerns guarded here are SECURITY and the CDP surface an external agent
uses to drive it.

## Contents

- `runtime.ts` — the single per-boot token for the agent-control surface.
  NO raw Chromium `--remote-debugging-port` is ever opened (audit 2026-09-06:
  it exposed the main window's full preload bridge to any local process).
- `manager.ts` — `installBrowserSecurity()` hardens every `<webview>` guest at
  attach (strip preload, force contextIsolation + sandbox, `webSecurity` on),
  blocks non-web `will-navigate`/`will-redirect`, permits sandboxed web sign-in
  popups sharing the guest session (nested popups denied), and keeps a
  node-id → guest-id map so `navigateBrowserNode()` can drive a node by its
  stable canvas id while enforcing the URL policy in one place.
- `agent-server.ts` — loopback, token-gated agent-control server: `GET /info`,
  `POST /open` (URL validated by core/browser-policy), discovery file
  `userData/browser-agent.json` (mode 0600). State-changing only; never open.
- `cdp-facade.ts` — "virtual browser" on its own loopback port that re-exposes
  every live guest as a standard `page` target so Playwright's `connectOverCDP`
  (and Puppeteer) can drive the exact page the user watches. Token REQUIRED on
  every HTTP discovery call and on the WS upgrade (`?token=` or bearer). See
  the big header comment: it implements Playwright's auto-attach model and —
  critically — reports each guest's REAL target id (== its main frame id,
  learned from the guest's own `Page.getFrameTree` at attach), because
  Playwright resolves frame sessions by that id and silently degrades the page
  to a dummy frame on mismatch. Browser-level Storage cookie commands map to
  the live guest profile; cookie writes flush to disk. Debug logs omit payloads.

## Rules

- The guest must NEVER carry a preload or Node — a page inside the browser can
  reach neither `window.termsprawl` nor Node.
- The URL policy lives in `src/core/browser-policy.ts` (pure, electron-free,
  TDD). Do not inline navigation checks here — import that.
- The CDP endpoint binds to 127.0.0.1 only. Do not loosen to 0.0.0.0.
- **Guest rendering has one hard CSS trap**: a `<webview>`'s
  `display` must never be `block`. Electron lays the guest out with its own flex
  layout, so `block` pins the guest viewport to Chromium's 150px default while
  the host element still honours `height:100%` — the node paints its top 150px
  and the rest is black. The renderer end of it is
  `src/renderer/src/nodes/BrowserNode.tsx` (`WEBVIEW_VISIBLE_DISPLAY`) +
  `styles.css`, guarded by `nodes/browser-webview-sizing.test.ts`. Symptom is
  visual, so do not hunt for it in this directory.

See ../../AGENTS.md for the process model.
