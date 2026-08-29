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
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { ServerPlatform } from './platform'
import { buildHandlers } from './handlers'
import { createDispatcher, type RpcDispatcher, type RpcResponse } from './rpc'
import { startAgentBridge } from './agent-bridge'
import { createSpacePusher, restoreFromCloud } from './space-sync-wiring'
import { createAuthPolicy, authorizeUpgrade, type AuthPolicy } from './server-auth'

const PORT = Number(process.env.PORT ?? process.argv[2] ?? 3110)
const RENDERER_DIR = resolve('out/renderer')
const SHIM_PATH = resolve('src/server/shim.js')

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

export async function createApp(opts?: { auth?: AuthPolicy }): Promise<{
  server: ReturnType<typeof createServer>
  platform: ServerPlatform
  port: number
  hookUrl: string
  /** The WS auth token (null when auth explicitly disabled). */
  authToken: string | null
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

  function serveStatic(path: string, res: ServerResponse): void {
    // Only index.html is served at '/'; everything else is a real asset path.
    const fileName = path === '/' ? 'index.html' : path.replace(/^\//, '')
    const filePath = resolve(RENDERER_DIR, fileName)
    if (!filePath.startsWith(RENDERER_DIR) || !existsSync(filePath)) {
      res.writeHead(404).end('not found')
      return
    }
    let body = readFileSync(filePath)
    if (path === '/' && shimSource) {
      const html = body.toString('utf8')
      // Audit B1: bootstrap the shim with the WS auth token. The page is served
      // by the same process that owns the token, so injecting it into THIS page
      // is the trust boundary; the shim stores it in localStorage for reconnects.
      const tokenBootstrap = `<script>window.__TERMPRAWL_WS_TOKEN=${JSON.stringify(policy.disabled ? '' : policy.token)}</script>`
      const shimTag = `<script>${tokenBootstrap}</script><script src="/termsprawl-shim.js"></script>`
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
      if (msg.t === 'send') {
        void dispatch({ id: 0, method: msg.method, args: msg.args ?? [] })
        return
      }
      // t === 'req'
      const requestId = Number(msg.id ?? 0)
      void dispatch({ id: requestId, method: msg.method, args: msg.args ?? [] }).then((response) => {
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
  // Audit B1: auth token. TERMSPRAWL_SERVER_TOKEN='' explicitly disables auth
  // (disclosed mode — logged loudly); absent → a fresh token is generated and
  // printed once; a 48-hex value is honored as-is (for scripted restarts).
  const envToken = process.env.TERMSPRAWL_SERVER_TOKEN
  const policy = createAuthPolicy(envToken)
  if (policy.disabled) {
    console.warn('[server] !!! AUTH DISABLED (TERMSPRAWL_SERVER_TOKEN="") — any local process can drive this instance. Loopback bind only.')
  }
  const app = await createApp({ auth: policy })
  const { server, port, platform, authToken } = app
  const dispatch = createDispatcher(buildHandlers(platform))

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
  // Audit B1: bind the LOOPBACK by default. TERMSPRAWL_SERVER_HOST=0.0.0.0
  // opts into LAN exposure (with TERMSPRAWL_SERVER_TOKEN set deliberately).
  const HOST = process.env.TERMSPRAWL_SERVER_HOST ?? '127.0.0.1'
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
  console.log(`termsprawl Server Edition listening on http://${process.env.TERMSPRAWL_SERVER_HOST ?? '127.0.0.1'}:${actualPort}`)
  if (authToken) {
    console.log(`ws auth token (browser asks for it once, then it's stored in localStorage):\n  ${authToken}`)
  }
  console.log(`data dir: ${platform.userDataPath}`)
  console.log(`agent hooks: ${app.hookUrl}`)

  // ---- Default welcome project ----
  const snap = await callResult('workspace:snapshot', [])
  const snapObj = snap as { index?: { projects?: unknown[] }; currentProjectId?: string; projects?: Record<string, { nodes?: unknown[] }> } | undefined
  if (snapObj?.index && Array.isArray(snapObj.index.projects) && snapObj.index.projects.length === 0) {
    await call('project:add', ['Welcome', null, undefined])
    console.log('[server] created default welcome project')
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
