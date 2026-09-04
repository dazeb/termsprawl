// Audit B8 — hook-server shared secret. Any local process could previously
// POST spoofed agent status events to the loopback hook server. A per-boot
// random token, embedded in the installed hook URL (?key=...), makes spoofing
// require reading the user's own settings.json — i.e. the machine is already
// compromised. The check is defense-in-depth only: a MISSING key still
// fails open (200, no event) so an old agent config never blocks the CLI.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { normalizeClaudeHook, normalizeCodexHook, type AgentStatusEvent } from './agent-status'

export type HookListener = (event: AgentStatusEvent) => void

/** Agent id → normalizer. Claude is supported today; add gemini/custom here. */
const NORMALIZERS: Record<string, (body: unknown) => AgentStatusEvent | null> = {
  claude: normalizeClaudeHook,
  codex: normalizeCodexHook
}

export class HookServer {
  private server: Server | null = null
  private port = 0
  private readonly key = randomBytes(24).toString('hex')

  constructor(private readonly listener: HookListener) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/`
  }

  get baseUrl(): string {
    return this.url
  }

  /** The per-boot secret embedded in installed hook URLs (audit B8). */
  get secret(): string {
    return this.key
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
          this.handle(req as IncomingMessage, req.url ?? '/', body)
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

  /** Route /hook/<agent> to the agent's normalizer. A wrong ?key= is ignored
   * silently (no event); a missing key still parses (fail-open for old
   * configs written before B8) — both return fast 200s. */
  private handle(req: IncomingMessage, url: string, body: string): void {
    const base = url.split('?')[0]
    const match = /^\/hook\/([a-z-]+)\/?$/.exec(base)
    if (!match) return
    const agent = match[1]
    const normalize = NORMALIZERS[agent]
    if (!normalize) return

    // Defense-in-depth token check (audit B8). Key travels in the query —
    // loopback-only, so it never crosses a network.
    const key = new URL(url, this.url).searchParams.get('key')
    if (key !== null && key !== this.key) return

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
