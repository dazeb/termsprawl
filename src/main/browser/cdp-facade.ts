// CDP facade — makes the embedded browser nodes driveable by Playwright.
//
// WHY: Playwright's `connectOverCDP` filters targets by type and does not
// surface Electron's `webview` guests (they report type `webview`). So while
// Puppeteer/raw-CDP attach fine, a Playwright-only agent (Hermes `browser_exec`,
// Browser Use CLI) never sees the embedded browser. This facade is a minimal
// "virtual browser" on its own loopback port: it presents every live browser-
// node guest as a standard `page` target and proxies page-level CDP through
// Electron's `webContents.debugger`, so Playwright (and Puppeteer) drive the
// exact page the user is watching.
//
// Playwright's connectOverCDP drives pages through Target.setAutoAttach +
// Target.attachedToTarget events (it never calls Target.attachToTarget itself),
// while Puppeteer uses Target.getTargets + attachToTarget. The facade supports
// both: attachToTarget works directly, and when auto-attach is on it attaches
// to every live guest, emits attachedToTarget for it, and keeps emitting as new
// guests appear (polled from the browser manager).
//
// SECURITY: bound to 127.0.0.1 only, random high port, and the per-boot token
// is REQUIRED on every HTTP discovery call and on the WebSocket upgrade
// (`?token=` on the ws URL, or `Authorization: Bearer`). Playwright and
// Puppeteer authenticate by carrying the token-bearing ws URL from the
// authenticated /json/version response (or the discovery file). State-changing
// actions (opening a node) go through the token-gated agent-control server
// (agent-server.ts). Audit 2026-09-06: the facade was previously open to any
// local process, and a raw Chromium debug port additionally exposed the main
// window — both are closed now.

// Set TERMSPRAWL_FACADE_DEBUG=1 to log every CDP message/event (verification).
const FACADE_DEBUG = process.env.TERMSPRAWL_FACADE_DEBUG === '1'

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket as Ws } from 'ws'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { app, webContents } from 'electron'
import { browserGuestIds } from './manager'

export interface CdpFacadeHandle {
  port: number
  /** http://127.0.0.1:<port> — hand to connectOverCDP / puppeteer. */
  url: string
  close(): Promise<void>
}

export interface StartCdpFacadeOptions {
  /**
   * Per-boot bearer token. REQUIRED on every HTTP discovery call
   * (`?token=` query or `Authorization: Bearer`) and on the WebSocket
   * upgrade (`?token=` on the ws URL). A facade that accepts connections
   * without this is a local RCE (audit 2026-09-06) — never default it.
   */
  token: string
  /** Loopback info of the app's raw debug port (surfaced for the agent). */
  cdpInfo: { wsUrl: string; host: string; port: number }
}

function versionString(): string {
  const chrome = process.versions.chrome ?? '0.0.0.0'
  const electron = process.versions.electron ?? app.getVersion()
  return `Chrome/${chrome} Electron/${electron}`
}

interface TargetInfo {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
  canAccessOpener: boolean
  openerId: string | null
  browserContextId: string | null
}

// Per-session routing: Playwright sends page-level commands with a sessionId;
// map that sessionId → guest webContents id and proxy via the guest debugger.
const sessionToGuest = new Map<string, number>()
const guestToSession = new Map<number, string>()
const forwardedGuests = new Set<number>()
let currentWs: Ws | null = null
// The facade is deliberately single-client: currentWs is a singleton and a
// second connection evicts the first (matching Chromium's own one-client debug
// port). One agent at a time is the product's intent.

// Guest webContents id -> the guest's REAL CDP target id. Chromium reports a
// webview guest's target id as its main frame id, and Playwright resolves
// frame sessions by walking frame._id through the targetId-keyed session map.
// Reporting the numeric webContents id here while getFrameTree reports the hex
// frame id makes Playwright's _sessionForFrame throw "Frame has been detached"
// and the page never initializes (silently degraded to a dummy frame). The id
// is learned from the guest's own debugger at attach time.
const guestTargetIds = new Map<number, string>()

function guestTargetId(guestId: number): string {
  return guestTargetIds.get(guestId) ?? String(guestId)
}

function guestIdForTargetId(targetId: string): number | undefined {
  for (const [guestId, tid] of guestTargetIds) {
    if (tid === targetId) return guestId
  }
  const n = Number(targetId)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

// Auto-attach state (Playwright's connect model): when enabled we attach to
// every live guest, emit Target.attachedToTarget for it, and keep emitting for
// guests that appear later (polled from the browser manager).
let autoAttach = false
const autoAttachedGuests = new Set<number>()
let guestPollTimer: NodeJS.Timeout | null = null

function liveGuest(guestId: number) {
  const c = webContents.fromId(guestId)
  return c && !c.isDestroyed() ? c : undefined
}

// Playwright's connectOverCDP asserts a non-empty browserContextId on every
// attached target and buckets pages into contexts by it. The facade presents
// one virtual browser, so every guest shares a single synthetic context id.
const FAKE_BROWSER_CONTEXT = randomBytes(8).toString('hex')

function buildTargetInfo(guestId: number, attached: boolean): TargetInfo {
  const c = liveGuest(guestId)
  return {
    targetId: guestTargetId(guestId),
    type: 'page',
    title: c ? c.getTitle() : '',
    url: c ? c.getURL() : '',
    attached,
    canAccessOpener: false,
    openerId: null,
    browserContextId: FAKE_BROWSER_CONTEXT
  }
}

function buildTargetInfos(): TargetInfo[] {
  return browserGuestIds().map((guestId) =>
    buildTargetInfo(guestId, guestToSession.has(guestId))
  )
}

/** Attach the guest debugger, create its session id, start event forwarding.
 * Also learns the guest's real CDP target id (== its main frame id) so
 * TargetInfo.targetId matches what Page.getFrameTree reports. */
async function attachGuest(guestId: number): Promise<string> {
  const existing = guestToSession.get(guestId)
  if (existing) return existing
  const c = liveGuest(guestId)
  if (!c) throw new Error(`no live webContents for guest ${guestId}`)
  const sessionId = randomBytes(16).toString('hex')
  sessionToGuest.set(sessionId, guestId)
  guestToSession.set(guestId, sessionId)
  // Idempotent: a previous facade instance may have left the debugger attached
  // (Electron allows only one debugger per webContents). Reuse it rather than
  // throwing — resetFacadeState() detaches on close, so this is belt-and-suspenders.
  if (!c.debugger.isAttached()) c.debugger.attach()
  ensureGuestEventForwarder(guestId)
  try {
    const { frameTree } = (await c.debugger.sendCommand('Page.getFrameTree')) as {
      frameTree?: { frame?: { id?: string } }
    }
    const id = frameTree?.frame?.id
    if (id) guestTargetIds.set(guestId, id)
  } catch {
    /* keep the numeric fallback */
  }
  return sessionId
}

function detachGuest(guestId: number, sessionId?: string): void {
  const sid = sessionId ?? guestToSession.get(guestId)
  if (sid) {
    sessionToGuest.delete(sid)
    guestToSession.delete(guestId)
  }
  autoAttachedGuests.delete(guestId)
  try {
    liveGuest(guestId)?.debugger.detach()
  } catch {
    /* already detached */
  }
}

/** Reset all per-instance routing state and release the guest debuggers so a
 * subsequent start (settings toggle off→on) attaches cleanly. Keeps the
 * per-guest event-forwarder marker (`forwardedGuests`) — the forwarder reads
 * live maps and no-ops once `guestToSession` is empty, and reinstalling it
 * would double-fire events. */
function resetFacadeState(): void {
  autoAttach = false
  currentWs = null
  for (const guestId of Array.from(guestToSession.keys())) {
    try {
      liveGuest(guestId)?.debugger.detach()
    } catch {
      /* already detached */
    }
  }
  sessionToGuest.clear()
  guestToSession.clear()
  autoAttachedGuests.clear()
  guestTargetIds.clear()
}

/** Emit Target.attachedToTarget for a guest to the current client. */
async function emitAttached(ws: Ws, guestId: number): Promise<void> {
  const sessionId = await attachGuest(guestId)
  autoAttachedGuests.add(guestId)
  ws.send(
    JSON.stringify({
      method: 'Target.attachedToTarget',
      params: {
        sessionId,
        targetInfo: buildTargetInfo(guestId, true),
        waitingForDebugger: false
      }
    })
  )
}

/** Install the per-guest debugger event forwarder once; push events to the client. */
function ensureGuestEventForwarder(guestId: number): void {
  if (forwardedGuests.has(guestId)) return
  const c = liveGuest(guestId)
  if (!c) return
  forwardedGuests.add(guestId)
  c.debugger.on('message', (_event, method, params) => {
    const sid = guestToSession.get(guestId)
    if (currentWs && currentWs.readyState === 1 && sid) {
      if (FACADE_DEBUG && method === 'Runtime.executionContextCreated') {
        console.error(
          '[cdp-facade] >> ctxCreated name=',
          JSON.stringify((params as { context?: { name?: string } }).context?.name),
          'frameId=',
          (params as { context?: { auxData?: { frameId?: string } } }).context?.auxData?.frameId
        )
      }
      currentWs.send(JSON.stringify({ method, params, sessionId: sid }))
    }
  })
}

export async function startCdpFacade(
  opts: StartCdpFacadeOptions
): Promise<CdpFacadeHandle> {
  const browserId = randomBytes(16).toString('hex')
  let boundPort = 0

  // Token check shared by HTTP + WS: query `?token=` or `Authorization: Bearer`.
  // Constant-time-ish compare via a full-string match on random 48-hex tokens;
  // the value is per-boot and unguessable, and we never log it.
  const authed = (req: IncomingMessage, queryToken: string | null): boolean => {
    const bearer = req.headers.authorization
    if (bearer && bearer === `Bearer ${opts.token}`) return true
    return queryToken !== null && queryToken === opts.token
  }
  const tokenFromUrl = (rawUrl: string | undefined): string | null => {
    try {
      return new URL(rawUrl ?? '/', 'http://127.0.0.1').searchParams.get('token')
    } catch {
      return null
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Playwright requests '/json/version/' (trailing slash); Chromium's devtools
    // server tolerates both forms — normalize before matching.
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/'
    if (path === '/json/version' || path === '/' || path === '/json') {
      // No token, no discovery: the ws URL embeds the token, so serving it
      // unauthenticated would hand the facade to any local process.
      if (!authed(req, tokenFromUrl(req.url))) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
        return
      }
      const ua = `${versionString()} Safari/537.36`
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          Browser: versionString(),
          'Protocol-Version': '1.3',
          'User-Agent': ua,
          'V8-Version': process.versions.v8 ?? '0.0.0',
          'WebKit-Version': '537.36',
          // The token rides in the ws URL so Playwright/Puppeteer (which
          // cannot send headers) still authenticate on the upgrade.
          webSocketDebuggerUrl: `ws://127.0.0.1:${boundPort}/devtools/browser/${browserId}?token=${opts.token}`,
          cdp: opts.cdpInfo
        })
      )
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  })

  server.on('error', () => {
    // port conflict → dead endpoint; agent simply won't find it
  })

  const wss = new WebSocketServer({ server, path: `/devtools/browser/${browserId}` })

  // Reject WebSocket connections that don't present the token (audit
  // 2026-09-06: the facade was open to any local process). The connection is
  // accepted at the TCP/upgrade level but closed immediately — no CDP message
  // is ever processed without the per-boot token, and the single-client slot
  // (currentWs) is only claimed after the check passes.
  wss.on('connection', (ws: Ws, req: IncomingMessage) => {
    if (!authed(req, tokenFromUrl(req.url))) {
      ws.close(4001, 'unauthorized')
      return
    }
    currentWs = ws
    ws.on('message', (data) => {
      let msg: FacadeMessage
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (FACADE_DEBUG) console.error('[cdp-facade] <<', JSON.stringify(msg).slice(0, 400))
      void route(ws, msg)
    })
    ws.on('close', () => {
      if (currentWs === ws) resetFacadeState()
    })
    ws.on('error', () => {})
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      boundPort = addr.port
      resolve()
    })
  })

  // While a Playwright client is auto-attached, poll the browser manager for
  // new guests and emit attachedToTarget for each newcomer (and
  // detachedFromTarget for guests that died). 500ms is plenty for
  // human-scale node creation.
  guestPollTimer = setInterval(() => {
    if (!autoAttach || !currentWs || currentWs.readyState !== 1) return
    const live = new Set(browserGuestIds())
    for (const guestId of live) {
      if (autoAttachedGuests.has(guestId)) continue
      emitAttached(currentWs, guestId).catch((e) => {
        console.warn('[cdp-facade] auto-attach failed for guest', guestId, String(e))
      })
    }
    for (const guestId of Array.from(autoAttachedGuests)) {
      if (live.has(guestId)) continue
      const sid = guestToSession.get(guestId)
      detachGuest(guestId)
      currentWs.send(
        JSON.stringify({
          method: 'Target.detachedFromTarget',
          params: { sessionId: sid, targetId: String(guestId) }
        })
      )
    }
  }, 500)

  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise<void>((resolve) => {
        if (guestPollTimer) clearInterval(guestPollTimer)
        guestPollTimer = null
        // Terminate connected clients so (a) the server can close promptly and
        // (b) turning the setting off actually cuts off an already-connected
        // agent rather than leaving its socket alive.
        for (const client of wss.clients) client.terminate()
        resetFacadeState()
        wss.close(() => {
          server.close(() => resolve())
        })
      })
  }
}

interface FacadeMessage {
  id?: number
  method?: string
  params?: unknown
  sessionId?: string
}

async function route(ws: Ws, msg: FacadeMessage): Promise<void> {
  const id = msg.id
  const send = (payload: Record<string, unknown>): void => {
    if (FACADE_DEBUG) console.error('[cdp-facade] >>', JSON.stringify(payload).slice(0, 400))
    if (ws.readyState === 1) ws.send(JSON.stringify({ id, ...payload }))
  }
  const sendErr = (code: number, message: string): void =>
    send({ error: { code, message } })

  // Page-level command → proxy to the guest's debugger.
  if (msg.sessionId) {
    const guestId = sessionToGuest.get(msg.sessionId)
    const c = guestId ? liveGuest(guestId) : undefined
    if (!c) {
      sendErr(-32000, 'session no longer valid')
      return
    }
    // Playwright page-init sends these on the child session, but the guest
    // debugger is a page target, not a browser one — answer them locally.
    if (
      msg.method === 'Runtime.runIfWaitingForDebugger' ||
      msg.method === 'Target.setAutoAttach'
    ) {
      send({ sessionId: msg.sessionId, result: {} })
      return
    }
    try {
      // webContents.debugger.sendCommand has no timeout; a command against a
      // frame that is mid-navigation can otherwise never resolve and would
      // hang the agent forever. Fail the call instead.
      const result = await Promise.race([
        c.debugger.sendCommand(msg.method ?? '', (msg.params ?? {}) as never),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`[cdp-facade] ${msg.method} timed out after 15s`)),
            15000
          )
        )
      ])
      send({ sessionId: msg.sessionId, result })
    } catch (e) {
      send({ sessionId: msg.sessionId, error: { code: -32000, message: String(e) } })
    }
    return
  }

  const method = msg.method ?? ''
  const params = (msg.params ?? {}) as Record<string, unknown>

  switch (method) {
    case 'Target.getTargets':
      return send({ result: { targetInfos: buildTargetInfos() } })
    case 'Target.getTargetInfo': {
      const raw = params.targetId
      if (raw === undefined || raw === null || raw === '') {
        // Playwright sends a no-arg getTargetInfo during connect; real Chromium
        // answers with the target the command is called on. Answer with the
        // first live guest (a `page` target) so Playwright's target-id
        // bookkeeping matches the attachedToTarget events it also receives.
        const first = browserGuestIds()[0]
        if (first !== undefined && liveGuest(first)) {
          return send({
            result: {
              targetInfo: buildTargetInfo(first, guestToSession.has(first))
            }
          })
        }
        return send({
          result: {
            targetInfo: {
              targetId: 'browser',
              type: 'browser',
              title: 'termsprawl',
              url: 'about:blank',
              attached: false,
              canAccessOpener: false,
              openerId: null,
              browserContextId: null
            }
          }
        })
      }
      const guestId = guestIdForTargetId(String(raw))
      const c = guestId ? liveGuest(guestId) : undefined
      if (!guestId || !c) return sendErr(-32000, 'unknown target')
      return send({
        result: {
          targetInfo: buildTargetInfo(guestId, guestToSession.has(guestId))
        }
      })
    }
    case 'Target.attachToTarget': {
      const guestId = guestIdForTargetId(String(params.targetId))
      if (!guestId || !liveGuest(guestId)) return sendErr(-32000, 'unknown target')
      try {
        const sessionId = await attachGuest(guestId)
        return send({ result: { sessionId } })
      } catch (e) {
        return sendErr(-32000, `attach failed: ${String(e)}`)
      }
    }
    case 'Target.detachFromTarget': {
      const sid = String(params.sessionId ?? '')
      const guestId = sessionToGuest.get(sid) ?? guestIdForTargetId(String(params.targetId ?? ''))
      if (!guestId) return send({ result: {} })
      detachGuest(guestId, sid || undefined)
      return send({ result: {} })
    }
    case 'Target.setAutoAttach': {
      const enable = Boolean(params.autoAttach)
      autoAttach = enable
      if (enable) {
        for (const guestId of browserGuestIds()) {
          if (autoAttachedGuests.has(guestId)) continue
          try {
            await emitAttached(ws, guestId)
          } catch (e) {
            console.warn('[cdp-facade] auto-attach failed for guest', guestId, String(e))
          }
        }
      } else {
        autoAttachedGuests.clear()
      }
      return send({ result: {} })
    }
    case 'Target.setDiscoverTargets':
    case 'Target.setAutoAttachIgnoreOrigin':
    case 'Target.activateTarget':
    case 'Target.closeTarget':
    case 'Browser.setDownloadBehavior':
    case 'Browser.setPermission':
    case 'Browser.grantPermissions':
      return send({ result: {} })
    case 'Target.createTarget':
      return sendErr(
        -32601,
        'Target.createTarget is not supported by termsprawl; open a browser node instead'
      )
    case 'Browser.getVersion':
      return send({
        result: {
          protocolVersion: '1.3',
          product: versionString(),
          revision: '',
          userAgent: `${versionString()} Safari/537.36`,
          jsVersion: process.versions.v8 ?? ''
        }
      })
    case 'Browser.getBrowserContexts':
    case 'Target.getBrowserContexts':
      return send({ result: { browserContextIds: [] } })
    case 'Browser.getWindowForTarget':
      return send({
        result: {
          windowId: 0,
          bounds: { left: 0, top: 0, width: 0, height: 0, windowState: 'normal' }
        }
      })
    case 'Browser.close':
      return send({ result: {} })
    default:
      console.warn(`[cdp-facade] unhandled browser command: ${method}`)
      return sendErr(-32601, `unsupported command: ${method}`)
  }
}
