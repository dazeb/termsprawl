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

/** Wrap the dispatcher to track dirty state for auto-save. */
function trackDirty(dispatch: RpcDispatcher): { dispatch: RpcDispatcher; markDirty: () => void } {
  return {
    dispatch,
    markDirty: () => { /* no-op at boot */ }
  }
}

export async function createApp(): Promise<{
  server: ReturnType<typeof createServer>
  platform: ServerPlatform
  port: number
  hookUrl: string
  close: () => Promise<void>
}> {
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
      const shimTag = '<script src="/termsprawl-shim.js"></script>'
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

  const wss = new WebSocketServer({ server, path: '/ws' })
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
  const app = await createApp()
  const { server, port, platform } = app
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
        server.listen(p, () => resolve(p))
      }
      tryPort(portNum, 0)
    })
  }

  const actualPort = await listenWithFallback(PORT)
  console.log(`termsprawl Server Edition listening on http://localhost:${actualPort}`)
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
        }
      }
    } catch {
      // best-effort
    }
  }, 30_000)

  // ---- Shutdown safety ----
  async function shutdown() {
    console.log('[server] shutting down...')
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
