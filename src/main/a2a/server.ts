// A2A server (Phase 19) — exposes live agent terminal nodes as A2A agents so
// external peers (Hermes mesh, other termsprawl nodes) can message them.
//
// Security posture (mirrors browser agent-server):
// - Bound to 127.0.0.1 only (never a LAN address).
// - Every request requires `Authorization: Bearer <per-boot-token>` (random
//   per start), agent card included (audit 2026-09-06: it was open and leaked
//   agent node titles + commands to any local process).
// - The whole surface is opt-in: `agentA2aServer` setting, default OFF.
//
// Delivery: inbound text is bracketed-pasted into the target node's PTY —
// the ONE channel every CLI (claude/codex/antigravity/grok/custom) reads.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A live agent node the server can route to. */
export interface A2aNodeInfo {
  id: string
  title: string
  /** Agent command preset (claude/codex/...) — informational in the card. */
  command: string
}

export interface A2aServerDeps {
  /** Live agent terminal nodes (re-evaluated per request). */
  agentNodes(): A2aNodeInfo[]
  /** Deliver text into a node's PTY (bracketed paste). Throw = RPC error. */
  deliverToNode(nodeId: string, text: string): Promise<void>
}

export interface A2aServerHandle {
  port: number
  token: string
  url: string
  /** Discovery file the peer/agent reads: { port, token, url }. */
  endpointFile: string
  close(): Promise<void>
}

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

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

/** Resolve the target node from the message text: "@title" / "<title>:" prefix
 * match (case-insensitive substring), falling back to the first agent. */
export function resolveTarget(text: string, nodes: A2aNodeInfo[]): A2aNodeInfo | null {
  if (nodes.length === 0) return null
  const lower = text.toLowerCase()
  for (const node of nodes) {
    const title = node.title.toLowerCase()
    if (title.length > 0 && (lower.includes(`@${title}`) || lower.startsWith(`${title}:`))) {
      return node
    }
  }
  return nodes[0]
}

/** Start the loopback A2A server. The OS assigns the port (listen on 0). */
export async function startA2aServer(opts: {
  userDataPath: string
} & A2aServerDeps): Promise<A2aServerHandle> {
  const token = randomBytes(24).toString('hex')
  let boundPort = 0

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0]

    // Discovery card — token-gated (audit 2026-09-06: was open, leaking agent
    // node titles + commands to any local process). Peers read the token from
    // the discovery file (a2a-agent.json) first, exactly as they do for
    // message/send, so gating the card breaks nothing.
    if (req.method === 'GET' && path === '/.well-known/agent-card.json') {
      if (req.headers.authorization !== `Bearer ${token}`) {
        json(res, 401, { ok: false, error: 'unauthorized' })
        return
      }
      const nodes = opts.agentNodes()
      json(res, 200, {
        name: 'termsprawl agents',
        description: 'Agent CLI nodes live on a termsprawl canvas. Address a node with "@<title>:" or "@<title>".',
        version: '1.0.0',
        url: `http://127.0.0.1:${boundPort}/`,
        capabilities: { streaming: false },
        skills: nodes.map((n) => ({
          id: n.id,
          name: n.title,
          description: `${n.command} agent session`
        }))
      })
      return
    }

    // Everything else is token-gated.
    if (req.headers.authorization !== `Bearer ${token}`) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return
    }

    if (req.method === 'POST' && (path === '/' || path === '/')) {
      const raw = await readBody(req)
      let parsed: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | null = null
      try {
        parsed = JSON.parse(raw || 'null')
      } catch {
        parsed = null
      }
      if (!parsed || parsed.jsonrpc !== '2.0' || parsed.method !== 'message/send') {
        json(res, 200, {
          jsonrpc: '2.0',
          id: parsed?.id ?? null,
          error: { code: -32601, message: 'method not found (only message/send is supported)' }
        })
        return
      }
      // Extract the text part.
      let text = ''
      let targetHint: string | null = null
      try {
        const params = parsed.params as {
          message?: { parts?: Array<{ kind?: unknown; text?: unknown }> }
        }
        for (const part of params?.message?.parts ?? []) {
          if (part && part.kind === 'text' && typeof part.text === 'string') {
            text = part.text
            break
          }
        }
      } catch {
        text = ''
      }
      if (text.trim().length === 0) {
        json(res, 200, {
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: -32602, message: 'message carries no text part' }
        })
        return
      }
      // "@<title>:" / "@<title>" addressing; unresolved hint falls back to default.
      const addressMatch = text.match(/@([^\s:]+)[:\s]/)
      if (addressMatch) targetHint = addressMatch[1]
      const nodes = opts.agentNodes()
      let target: A2aNodeInfo | null = null
      if (targetHint) {
        const hint = targetHint.toLowerCase()
        target =
          nodes.find((n) => n.id.toLowerCase() === hint) ??
          nodes.find((n) => n.title.toLowerCase() === hint) ??
          null
      }
      if (!target) target = resolveTarget(text, nodes)
      if (!target) {
        json(res, 200, {
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: -32602, message: 'no live agent nodes to deliver to' }
        })
        return
      }
      try {
        await opts.deliverToNode(target.id, text)
      } catch (err) {
        json(res, 200, {
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: -32000, message: `delivery failed: ${err instanceof Error ? err.message : String(err)}` }
        })
        return
      }
      json(res, 200, {
        jsonrpc: '2.0',
        id: parsed.id ?? null,
        result: {
          kind: 'message',
          role: 'agent',
          messageId: `tsprawl-${randomBytes(8).toString('hex')}`,
          parts: [{ kind: 'text', text: `delivered to ${target.title} (${target.command})` }]
        }
      })
      return
    }

    json(res, 404, { ok: false, error: 'not found' })
  })

  server.on('error', () => {
    // Port/socket error → endpoint dead; peers will simply not find it.
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      boundPort = addr.port
      resolve()
    })
  })

  // Discovery file — peers/agents read this to find the endpoint + token.
  // Mode 0600: carries the bearer token; never world-readable.
  mkdirSync(opts.userDataPath, { recursive: true })
  const endpointFile = join(opts.userDataPath, 'a2a-agent.json')
  writeFileSync(
    endpointFile,
    JSON.stringify(
      {
        port: boundPort,
        token,
        url: `http://127.0.0.1:${boundPort}`
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
        // Remove the discovery file so a stopped endpoint is never advertised.
        try {
          rmSync(endpointFile, { force: true })
        } catch {
          /* best effort */
        }
      })
  }
}
