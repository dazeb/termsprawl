// Loopback hook server — the endpoint agent CLIs POST lifecycle events to.
//
// Agent hooks are configured to fire HTTP requests at this server (e.g. a
// Claude Code URL hook: http://127.0.0.1:<port>/hook/claude). The server
// normalizes the payload into the shared status model and forwards it to the
// renderer, so agent nodes can show RUNNING / NEEDS YOU badges.
//
// Fail-open by design: the agent CLI must never block or crash because of us.
// Unknown agents, malformed JSON, and unparseable payloads all get a fast 200
// and are ignored. Only loopback is bound (127.0.0.1), never a LAN address.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { normalizeClaudeHook, type AgentStatusEvent } from '../../core/agent-status'

export type HookListener = (event: AgentStatusEvent) => void

/** Agent id → normalizer. Claude is supported today; add gemini/custom here. */
const NORMALIZERS: Record<string, (body: unknown) => AgentStatusEvent | null> = {
  claude: normalizeClaudeHook
}

export class HookServer {
  private server: Server | null = null
  private port = 0

  constructor(private readonly listener: HookListener) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/`
  }

  get baseUrl(): string {
    return this.url
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        // Fail-open: keep the response fast and always 2xx unless it's a
        // method we don't speak. Never throw into the agent's request.
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
          if (body.length > 256 * 1024) req.destroy()
        })
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          this.handle(req.url ?? '/', body)
        })
      })

      server.on('error', () => {
        // Port conflicts resolve to a dead server; callers see events never
        // arrive but the agent CLI is unaffected (fail-open).
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo
        this.port = addr.port
        this.server = server
        resolve()
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** Route /hook/<agent> to the agent's normalizer. */
  private handle(url: string, body: string): void {
    const match = /^\/hook\/([a-z-]+)\/?$/.exec(url)
    if (!match) return
    const agent = match[1]
    const normalize = NORMALIZERS[agent]
    if (!normalize) return

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return // malformed JSON — ignore, keep fail-open
    }

    const event = normalize(parsed)
    if (event) this.listener(event)
  }
}
