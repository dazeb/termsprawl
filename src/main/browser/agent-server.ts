// Agent control server — lets an EXTERNAL agent (Hermes / puppeteer / computer
// use) ask the app to open a browser node, so the user watches the agent's page
// without manually adding a node. Unlike the hook server (fail-open by design),
// this MUST be authenticated: it can change app state.
//
// Security posture:
// - Bound to 127.0.0.1 only (never a LAN address).
// - Every request requires `Authorization: Bearer <token>`; the token is random
//   per session and written to a discovery file the agent reads.
// - POST /open validates the URL against core/browser-policy before broadcasting.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeAddress, ABOUT_BLANK } from '../../core/browser-policy'

/** Broadcast channel main → renderer when an agent asks to open a browser node. */
export const AGENT_OPEN_CHANNEL = 'browser:agent-open'

export interface AgentServerHandle {
  port: number
  token: string
  /** http://127.0.0.1:<port> — hand this (with the token) to an agent. */
  url: string
  /** Discovery file the agent reads to find port/token/cdp. */
  endpointFile: string
  close(): Promise<void>
}

export interface StartAgentServerOptions {
  userDataPath: string
  /** Forward the open command to the renderer (the app's broadcast seam). */
  broadcast: (channel: string, payload: unknown) => void
  cdp: { wsUrl: string; host: string; port: number; token: string }
  /**
   * Per-boot token shared with the CDP facade so browserCdpInfo stays
   * coherent (one token for the whole agent-control surface). Omit → a fresh
   * random token is generated (tests, standalone use).
   */
  token?: string
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 256 * 1024) req.destroy()
    })
    req.on('end', () => resolve(body))
  })
}

/** Start the loopback agent-control server. The OS assigns the port (listen on
 * 0) so a random-port collision can never hang startup. */
export async function startAgentServer(
  opts: StartAgentServerOptions
): Promise<AgentServerHandle> {
  const token = opts.token ?? randomBytes(24).toString('hex')
  let boundPort = 0

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const authed = req.headers.authorization === `Bearer ${token}`
    if (!authed) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return
    }

    const path = (req.url ?? '/').split('?')[0]

    if (req.method === 'GET' && (path === '/' || path === '/info')) {
      json(res, 200, {
        ok: true,
        cdp: opts.cdp,
        open: { method: 'POST', path: '/open', url: `http://127.0.0.1:${boundPort}/open` }
      })
      return
    }

    if (req.method === 'POST' && path === '/open') {
      const raw = await readBody(req)
      let url = ''
      try {
        const parsed = JSON.parse(raw || '{}') as { url?: unknown }
        if (typeof parsed.url === 'string') url = parsed.url
      } catch {
        // empty/malformed body → open the default blank page
      }
      // Normalize + validate; empty means about:blank, invalid is denied.
      const normalized = url ? normalizeAddress(url) : ABOUT_BLANK
      if (url && !normalized) {
        json(res, 400, { ok: false, error: 'denied url' })
        return
      }
      const target = normalized ?? ABOUT_BLANK
      opts.broadcast(AGENT_OPEN_CHANNEL, { url: target })
      json(res, 200, { ok: true, url: target })
      return
    }

    json(res, 404, { ok: false, error: 'not found' })
  })

  server.on('error', () => {
    // Port/socket error → endpoint dead; the agent will simply not find it.
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      boundPort = addr.port
      resolve()
    })
  })

  // Discovery file — the agent reads this to find the endpoint, token, and cdp.
  // Mode 0600: the file carries the bearer token; never world-readable.
  mkdirSync(opts.userDataPath, { recursive: true })
  const endpointFile = join(opts.userDataPath, 'browser-agent.json')
  const openUrl = `http://127.0.0.1:${boundPort}/open`
  writeFileSync(
    endpointFile,
    JSON.stringify(
      {
        port: boundPort,
        token,
        cdp: opts.cdp,
        open: { method: 'POST', path: '/open', url: openUrl }
      },
      null,
      2
    ),
    { mode: 0o600 }
  )

  return {
    port: boundPort,
    token,
    url: `http://127.0.0.1:${boundPort}`,
    endpointFile,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        // Remove the discovery file so a stopped endpoint is never advertised
        // (agent would find a stale port/token and fail to connect).
        try {
          rmSync(endpointFile, { force: true })
        } catch {
          /* best effort */
        }
      })
  }
}
