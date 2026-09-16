// BrowserManager — secures and controls every browser-node <webview> guest.
//
// termsprawl IS Chromium, so a browser node is a real (sandboxed) guest
// webContents rendered inline in the canvas. This module is the main-process
// enforcement point: it (a) sanitises the guest's webPreferences the moment it
// is attached, (b) bars navigation to anything that isn't an ordinary web
// origin, (c) sandboxes sign-in popups, and (d) keeps a node-id → guest-id map so
// anything (the renderer toolbar, or an agent via IPC) can drive a specific
// node by its stable canvas id.
//
// The guest never carries a preload and never gets nodeIntegration, so a page
// inside the browser can reach neither termsprawl's preload API nor Node.

import { app, BrowserWindow, webContents, type WebContents } from 'electron'
import { isAllowedNavUrl } from '../../core/browser-policy'

type NodeId = string
type GuestId = number

// nodeId::tabId -> the guest WebContents id of the live webview for that tab
// (a browser node can hold several tabs, each its own guest).
const guests = new Map<string, GuestId>()

function guestKey(nodeId: string, tabId: string): string {
  return `${nodeId}::${tabId}`
}

export function guestIdForNode(nodeId: string, tabId: string): GuestId | undefined {
  return guests.get(guestKey(nodeId, tabId))
}

export function registerBrowserGuest(nodeId: string, tabId: string, guestId: number): void {
  guests.set(guestKey(nodeId, tabId), guestId)
}

export function unregisterBrowserGuest(nodeId: string, tabId: string): void {
  // The guest webContents itself is destroyed by the renderer when the tab's
  // <webview> element is removed (Electron ties guest lifetime to the embedder
  // DOM; there is no main-side destroy for guests). This just reaps the map
  // entry so nothing references a closed tab.
  guests.delete(guestKey(nodeId, tabId))
}

/** Live guest webContents ids for every browser node (used by the CDP facade).
 * Reaps dead entries (renderer crash before unregister) as it goes, so the map
 * stays bounded and the facade never advertises a corpse as a driveable target. */
export function browserGuestIds(): GuestId[] {
  const live: GuestId[] = []
  for (const [key, guestId] of guests) {
    let alive = false
    try {
      const c = webContents.fromId(guestId)
      alive = c !== undefined && !c.isDestroyed()
    } catch {
      alive = false
    }
    if (alive) live.push(guestId)
    else guests.delete(key)
  }
  return live
}

/** Force the safe prefs on a guest at the moment the parent attaches it. By
 * the time web-contents-created fires the webPreferences are already baked, so
 * this is the only reliable place to strip a preload and force isolation. */
function sanitizeAttachedWebview(webPreferences: Electron.WebPreferences): void {
  delete webPreferences.preload
  webPreferences.nodeIntegration = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.experimentalFeatures = false
}

/** Login popups share only the embedded browser profile, never the app bridge. */
export function secureBrowserContents(contents: WebContents, allowPopups = true): void {
  const browserSession = contents.session
  const guard = (event: Electron.Event, url: string): void => {
    if (!isAllowedNavUrl(url)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.setWindowOpenHandler(({ url }) => {
    if (!allowPopups || !isAllowedNavUrl(url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 600, height: 760, autoHideMenuBar: true,
        parent: BrowserWindow.fromWebContents(contents.hostWebContents ?? contents) ?? undefined,
        webPreferences: {
          session: browserSession, nodeIntegration: false,
          contextIsolation: true, sandbox: true, webSecurity: true,
          allowRunningInsecureContent: false, webviewTag: false
        }
      }
    }
  })
  contents.on('did-create-window', (popup) => {
    secureBrowserContents(popup.webContents, false)
    const closePopup = (): void => { if (!popup.isDestroyed()) popup.close() }
    contents.once('destroyed', closePopup)
    popup.once('closed', () => {
      contents.removeListener('destroyed', closePopup)
      void browserSession.cookies.flushStore().catch(() => {})
    })
  })
}

/**
 * Install the per-process browser security hooks. Call once, before any
 * webview is created (module top-level in index.ts).
 * - Every webview guest: block non-web navigation + sandbox sign-in popups.
 * - Every parent webContents: sanitise the guest prefs before attach.
 */
export function installBrowserSecurity(): void {
  // On any webContents that may host a <webview>, force safe guest prefs the
  // instant one is attached. We do this on every creation event and let the
  // guest-type check below do the targeting, so a stray webview anywhere is
  // still locked down.
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-attach-webview', (event, webPreferences) => {
      sanitizeAttachedWebview(webPreferences)
    })

    if (contents.getType() !== 'webview') return

    secureBrowserContents(contents)

  })
}

/**
 * Navigate a browser node to a URL, or 'denied' when the address isn't a plain
 * web origin. Centralises navigation through main so the policy is enforced in
 * one place, whether the request comes from the node toolbar or an agent.
 */
export async function navigateBrowserNode(
  nodeId: string,
  tabId: string,
  url: string
): Promise<{ ok: true } | { ok: false; reason: 'UNKNOWN_NODE' | 'DENIED' }> {
  const guestId = guests.get(guestKey(nodeId, tabId))
  if (guestId === undefined) return { ok: false, reason: 'UNKNOWN_NODE' }
  // Resolve by id so a stale guest id after a crash-corner case still targets
  // the actual live webContents.
  const contents = webContents.fromId(guestId)
  if (!contents || contents.isDestroyed()) {
    guests.delete(guestKey(nodeId, tabId))
    return { ok: false, reason: 'UNKNOWN_NODE' }
  }
  if (!isAllowedNavUrl(url)) return { ok: false, reason: 'DENIED' }
  try {
    await contents.loadURL(url)
    return { ok: true }
  } catch {
    // A failed navigation (host unreachable, TLS error) is not a policy deny.
    return { ok: true }
  }
}
