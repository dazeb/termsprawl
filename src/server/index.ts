// termsprawl Server Edition — plain node:http + ws.
//
// Serves the built renderer (out/renderer) with the browser shim injected, and
// tunnels the renderer's window.termsprawl calls to the same electron-free core
// services the desktop main process uses, over a WebSocket RPC channel.
//
// Run `pnpm run build && pnpm run build:server`, then `node out/server/index.js`
// (optionally PORT=3110). Boot reads (settings/updates/announcements/workspace),
// projects, and terminals are wired; git/cloud/accounts/agent-hooks are the
// renderer-side "not available" rejections in src/server/shim.js.

import { createServer, type ServerResponse, type IncomingMessage } from 'node:http'
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { ServerPlatform } from './platform'
import { buildHandlers } from './handlers'
import { createDispatcher, type RpcDispatcher, type RpcResponse } from './rpc'
import { startAgentBridge } from './agent-bridge'
import { createSpacePusher, restoreFromCloud } from './space-sync-wiring'
import { createAuthPolicy, authorizeUpgrade, timingSafeCompare, type AuthPolicy } from './server-auth'
import { assertSafeServerBind, resolveContainedPath } from './server-boundary'
import { IPC } from '../shared/ipc'

const PORT = Number(process.env.PORT ?? process.argv[2] ?? 3110)
const RENDERER_DIR = resolve('out/renderer')
const SHIM_PATH = resolve('src/server/shim.js')

/** True only for an existing regular file (directories must never be read). */
function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm'
}

function contentType(path: string): string {
  return MIME[extname(path)] ?? 'application/octet-stream'
}

/** Pull ?token= out of an upgrade URL (fallback auth channel for browsers). */
function tokenFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url, 'http://localhost').searchParams.get('token') ?? undefined
  } catch {
    return undefined
  }
}

/** Wrap the dispatcher to track dirty state for auto-save. */
function trackDirty(dispatch: RpcDispatcher): { dispatch: RpcDispatcher; markDirty: () => void } {
  return {
    dispatch,
    markDirty: () => { /* no-op at boot */ }
  }
}

/** RPC methods that change the persisted canvas — the space-sync push hook
 * marks dirty on any of these arriving over WS (the renderer's saves are the
 * real change signal; the 30s poll is only a safety net). */
const MUTATING_METHODS = new Set([
  'workspace:save-nodes', 'project:add', 'project:import', 'project:delete',
  'project:rename', 'project:close', 'project:archive', 'project:reopen',
  'project:update-settings', 'terminal:close'
])

export async function createApp(opts?: { auth?: AuthPolicy; onRequest?: (method: string) => void }): Promise<{
  server: ReturnType<typeof createServer>
  platform: ServerPlatform
  port: number
  hookUrl: string
  /** The WS auth token (null when auth explicitly disabled). */
  authToken: string | null
  /** The app's ONE dispatcher — the entrypoint must reuse it (not build its
   * own) so WS traffic and boot-time calls share the same handler/store
   * instances (revs maps would desync otherwise). */
  dispatch: RpcDispatcher
  close: () => Promise<void>
}> {
  // Audit B1: every WS connection must present the boot token. Fail-closed:
  // no policy passed in → a fresh token is generated (the entrypoint prints it
  // once); explicit empty token = disclosed mode (logged by the caller).
  const policy = opts?.auth ?? createAuthPolicy()
  const clients = new Set<WebSocket>()
  const platform = new ServerPlatform((channel, payload) => {
    const frame = JSON.stringify({ t: 'evt', channel, payload })
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame)
    }
  })
  const dispatch = createDispatcher(buildHandlers(platform))
  const agents = await startAgentBridge(platform)

  const shimSource = existsSync(SHIM_PATH) ? readFileSync(SHIM_PATH, 'utf8') : ''
  // CSP-safe token bootstrap: the page's Content-Security-Policy allows only
  // `script-src 'self'`, so inline bootstrap scripts can never execute (and
  // must not be injected). The token is served as a real same-origin script
  // instead; the shim (also same-origin) reads the global it defines.
  const bootJs = `window.__TERMPRAWL_WS_TOKEN=${JSON.stringify(policy.disabled ? '' : policy.token)};\n`

  // Container-side gate (space defense-in-depth): inside a hosted space the
  // router authenticates every request and re-injects the deterministic shared
  // secret (sha256 hex of `${SPACE_JWT_SECRET}:${login}`) as
  // `X-Termsprawl-Space`. Only then is the WS boot token served — a direct hit
  // on the app port (another tenant on a shared bridge) has no such header and
  // gets 401, never the token. A plain offline Server Edition run (no
  // TERMSPRAWL_SPACE_HEADER env) has no router and is unchanged: the token is
  // served as today. The manager sets TERMSPRAWL_SPACE_HEADER only in a space
  // container, so this stays inert on localhost-only runs.
  const spaceHeader = process.env.TERMSPRAWL_SPACE_HEADER
  function routerAuthenticated(req: IncomingMessage): boolean {
    if (!spaceHeader) return true
    const raw = req.headers['x-termsprawl-space']
    const presented = Array.isArray(raw) ? raw[0] : raw
    return typeof presented === 'string' && presented.length > 0
      ? timingSafeCompare(presented, spaceHeader)
      : false
  }

  function serveStatic(path: string, res: ServerResponse): void {
    // Only index.html is served at '/'; everything else is a real asset path.
    const fileName = path === '/' ? 'index.html' : path.replace(/^\//, '')
    const filePath = resolveContainedPath(RENDERER_DIR, fileName)
    // A directory under out/renderer passes an existence check but throws
    // EISDIR on read — and an uncaught throw here takes the whole process down
    // (one unauthenticated GET /assets was enough), so only regular files serve.
    if (!filePath || !isRegularFile(filePath)) {
      res.writeHead(404).end('not found')
      return
    }
    let body = readFileSync(filePath)
    if (path === '/' && shimSource) {
      const html = body.toString('utf8')
      // Audit B1: bootstrap the shim with the WS auth token. The token rides
      // in /termsprawl-boot.js (served below, same origin — CSP-clean). The
      // shim stores it in localStorage for reconnects.
      const shimTag = `<script src="/termsprawl-boot.js"></script><script src="/termsprawl-shim.js"></script>`
      const injected = html.includes('<head>') ? html.replace('<head>', `<head>${shimTag}`) : `${shimTag}${html}`
      body = Buffer.from(injected, 'utf8')
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) }).end(body)
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? '/').split('?')[0]
    if (url === '/termsprawl-shim.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(shimSource)
      return
    }
    if (url === '/termsprawl-boot.js') {
      // Gate: only router-authenticated requests may fetch the WS boot token
      // inside a space container (see routerAuthenticated above). 401 before
      // any token bytes leave the process.
      if (!routerAuthenticated(req)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' }).end('router required')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Cache-Control': 'no-store',
      }).end(bootJs)
      return
    }
    serveStatic(url, res)
  })

  const wss = new WebSocketServer({ noServer: true })
  // Audit B1: token gate BEFORE any connection is accepted. The header wins
  // (shim sends it); ?token= is the fallback for browser WS limitations.
  server.on('upgrade', (req, socket, head) => {
    // Audit B1: only /ws upgrades, and only with the token.
    const url = (req.url ?? '/').split('?')[0]
    if (url !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const auth = authorizeUpgrade(policy, req.headers.authorization, tokenFromUrl(req.url))
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  wss.on('connection', (socket: WebSocket) => {
    clients.add(socket)
    socket.on('message', (raw: unknown) => {
      let msg: { t?: string; id?: number; method?: string; args?: unknown[] }
      try {
        const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : String(raw)
        msg = JSON.parse(text)
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'res' || !msg.method) return
      const isMutating = Boolean(opts?.onRequest && MUTATING_METHODS.has(msg.method))
      const markApplied = (): void => {
        // Mark dirty AFTER the mutation is applied: the coalescing pusher
        // snapshots live state, and a dirty mark on message ARRIVAL races
        // the save — the push then carries stale nodes with nothing left to
        // re-mark dirty (the e2e restart step caught exactly this).
        if (isMutating) opts?.onRequest?.(msg.method as string)
      }
      if (msg.t === 'send') {
        void dispatch({ id: 0, method: msg.method, args: msg.args ?? [] }).then(markApplied)
        return
      }
      // t === 'req'
      const requestId = Number(msg.id ?? 0)
      void dispatch({ id: requestId, method: msg.method, args: msg.args ?? [] }).then((response) => {
        markApplied()
        if (!response || socket.readyState !== WebSocket.OPEN) return
        socket.send(
          JSON.stringify({ t: 'res', id: response.id, ok: response.ok, result: response.result, error: response.error })
        )
      })
    })
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })

  return {
    server,
    platform,
    port: PORT,
    hookUrl: agents.hookUrl,
    authToken: policy.disabled ? null : policy.token,
    dispatch,
    close: async () => {
      agents.stop()
      for (const client of [...clients]) client.close()
      await new Promise<void>((resolveClose) => wss.close(() => resolveClose()))
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
  }
}

// Start only when run directly (the test imports createApp without booting a
// listener). Run via `TERMSPRAWL_SERVER_ENTRY=1 node out/server/index.js`.
if (process.env.TERMSPRAWL_SERVER_ENTRY === '1') {
  const HOST = process.env.TERMSPRAWL_SERVER_HOST ?? '127.0.0.1'
  try {
    assertSafeServerBind(HOST, Boolean(process.env.TERMSPRAWL_SPACE_HEADER))
  } catch (error) {
    console.error('[server] refusing to start:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  // Audit B1: auth token. TERMSPRAWL_SERVER_TOKEN='' explicitly disables auth
  // (disclosed mode — logged loudly); absent → a fresh token is generated and
  // printed once; a 48-hex value is honored as-is (for scripted restarts).
  const envToken = process.env.TERMSPRAWL_SERVER_TOKEN
  const policy = createAuthPolicy(envToken)
  if (policy.disabled) {
    console.warn('[server] !!! AUTH DISABLED (TERMSPRAWL_SERVER_TOKEN="") — any local process can drive this instance. Loopback bind only.')
  }
  const app = await createApp({
    auth: policy,
    // Space-sync dirty hook: mutating WS RPCs mark the pusher (the renderer's
    // saves are the real change signal; the 30s poll is only a safety net).
    onRequest: (method) => {
      if (spacePusher && MUTATING_METHODS.has(method)) spacePusher.markDirty()
    },
  })
  const { server, port, platform, authToken, dispatch } = app
  // The app's ONE dispatcher (shared with WS traffic — separate instances
  // would desync the workspace store's revs map between boot calls and WS).

  /** Invoke an RPC and return the response. */
  function call(method: string, args: unknown[]): Promise<RpcResponse | null> {
    return dispatch({ id: 0, method, args })
  }

  /** Invoke and pluck the result field. */
  async function callResult(method: string, args: unknown[]): Promise<unknown> {
    const res = await call(method, args)
    return res?.ok ? res.result : undefined
  }

  // ---- Auto-save: track dirty state ----
  let dirty = false
  // Patch the WS message handler to flag dirty state. We do this by
  // re-reading the handler: the wss is already set up in createApp, so
  // we install a proxy on the first message handler. Simpler: just poll
  // workspace:snapshot and save on any change.
  const currentProjectNodes = new Map<string, unknown[]>()

  // ---- Space sync (online canvas spaces) ----
  // Active only when the space env is present (TS_CLOUD_API + TS_SPACE_BOOT_TOKEN);
  // otherwise this is a plain offline Server Edition. Restore pulls the latest
  // snapshot (rev-guarded) BEFORE the welcome project check; pushes ride the
  // 30s auto-save timer's dirty detection; shutdown forces a final flush.
  let spacePusher: ReturnType<typeof createSpacePusher> | null = null
  if (process.env.TS_CLOUD_API && process.env.TS_SPACE_BOOT_TOKEN) {
    const syncDeps = {
      cfg: {
        apiBase: process.env.TS_CLOUD_API,
        bootToken: process.env.TS_SPACE_BOOT_TOKEN,
        fetchFn: fetch,
      },
      userDataPath: platform.userDataPath,
      call: async (method: string, args: unknown[]) => (await callResult(method, args)) ?? {},
      log: (...parts: unknown[]) => console.log('[space-sync]', ...parts),
    }
    await restoreFromCloud(syncDeps)
    spacePusher = createSpacePusher(syncDeps)
    console.log('[space-sync] active (cloud:', process.env.TS_CLOUD_API + ')')
  }

  // ---- Port fallback: try PORT, PORT+1, ... PORT+10 ----
  function listenWithFallback(portNum: number, maxAttempts = 10): Promise<number> {
    return new Promise((resolve, reject) => {
      function tryPort(p: number, attempt: number) {
        if (attempt > maxAttempts) {
          console.error(`[server] could not bind any port in range ${portNum}-${portNum + maxAttempts}`)
          process.exit(1)
        }
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`[server] port ${p} in use, trying ${p + 1}`)
            tryPort(p + 1, attempt + 1)
          } else {
            reject(err)
          }
        })
        server.listen(p, HOST, () => resolve(p))
      }
      tryPort(portNum, 0)
    })
  }

  const actualPort = await listenWithFallback(PORT)
  console.log(`termsprawl Server Edition listening on http://${HOST}:${actualPort}`)
  if (authToken) {
    console.log(`ws auth token (browser asks for it once, then it's stored in localStorage):\n  ${authToken}`)
  }
  console.log(`data dir: ${platform.userDataPath}`)
  console.log(`agent hooks: ${app.hookUrl}`)

  // ---- Default welcome project ----
  const snap = await callResult('workspace:snapshot', [])
  const snapObj = snap as { index?: { projects?: unknown[] }; currentProjectId?: string; projects?: Record<string, { nodes?: unknown[] }> } | undefined
  if (snapObj?.index && Array.isArray(snapObj.index.projects) && snapObj.index.projects.length === 0) {
    const created = await callResult('project:add', ['Welcome', null, undefined]) as { id?: string } | undefined
    console.log('[server] created default welcome project')
    // Seed ONE terminal node so a fresh space (or offline Server Edition boot)
    // opens on a ready shell, not an empty canvas. Same shape the renderer's
    // createTerminalNode factory persists (SerializedNode): explicit
    // width/height + style so the node renders at terminal size instead of
    // collapsing (see state/workspace.ts TERMINAL_DIMENSIONS comment).
    // Only for the boot-created project (id known); a restore already wrote
    // its own nodes — and the zero-projects guard means nothing else ran.
    if (created?.id) {
      await call('workspace:save-nodes', [
        created.id,
        [{
          id: 'n-welcome',
          type: 'terminal',
          position: { x: 80, y: 90 },
          width: 720,
          height: 420,
          style: { width: 720, height: 420 },
          data: { kind: 'terminal', title: 'shell' }
        }]
      ])
      console.log('[server] seeded welcome terminal')
    }
  }

  // ---- GitHub import suggestions (Phase 17) ----
  // Best-effort, once per boot: list the user's connected GitHub repos and
  // broadcast the ones this space doesn't have yet — the renderer shows a
  // one-click import banner. Never blocks boot; never throws.
  if (process.env.TS_CLOUD_API && process.env.TS_SPACE_BOOT_TOKEN) {
    void (async () => {
      try {
        const { listSuggestedRepos } = await import('../core/github-import')
        const state = await callResult('workspace:snapshot', [])
        const snapState = state as { index?: { projects?: Array<{ id: string; name?: string; cwd?: string | null; closed?: boolean; archived?: boolean }> } } | undefined
        const projects = snapState?.index?.projects ?? []
        const names = projects
          .filter((p) => !p.archived)
          .flatMap((p) => [p.name ?? '', (p.cwd ?? '').split('/').filter(Boolean).pop() ?? ''])
          .filter(Boolean)
        const repos = await listSuggestedRepos(
          { cloudApi: process.env.TS_CLOUD_API as string, bootToken: process.env.TS_SPACE_BOOT_TOKEN as string },
          names
        )
        if (repos.length > 0) {
          platform.broadcast(IPC.githubSuggest, { repos })
          console.log(`[github-import] suggesting ${repos.length} repo(s) for import`)
        }
      } catch (error) {
        console.log('[github-import] suggest failed:', error instanceof Error ? error.message : String(error))
      }
    })()
  }

  // ---- Auto-save interval ----
  setInterval(async () => {
    try {
      const s = await callResult('workspace:snapshot', [])
      const state = s as { currentProjectId?: string; projects?: Record<string, { nodes?: unknown[] }> } | undefined
      if (state?.currentProjectId && state.projects?.[state.currentProjectId]) {
        const projectId = state.currentProjectId
        const nodes = state.projects[projectId]?.nodes ?? []
        const prev = currentProjectNodes.get(projectId)
        // Compare by JSON to detect changes (cheap for node arrays)
        const key = JSON.stringify(nodes)
        if (key !== JSON.stringify(prev)) {
          currentProjectNodes.set(projectId, nodes)
          await call('workspace:save-nodes', [projectId, nodes])
          spacePusher?.markDirty() // canvas changed → coalesced snapshot push
        }
      }
    } catch {
      // best-effort
    }
  }, 30_000)

  // ---- Shutdown safety ----
  async function shutdown() {
    console.log('[server] shutting down...')
    // Final space snapshot first (best-effort, never blocks exit long).
    if (spacePusher) {
      try {
        await Promise.race([spacePusher.flush(), new Promise((r) => setTimeout(r, 5000))])
      } catch {
        // best-effort — the periodic push will catch up next boot
      }
    }
    // Flush dirty state: save all projects
    try {
      const s = await callResult('workspace:snapshot', [])
      const state = s as { index?: { projects?: Array<{ id: string }> }; projects?: Record<string, { nodes?: unknown[] }> } | undefined
      if (state?.projects) {
        for (const [pid, project] of Object.entries(state.projects)) {
          if (project?.nodes) {
            await call('workspace:save-nodes', [pid, project.nodes])
          }
        }
      }
    } catch {
      // best-effort
    }
    await app.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
