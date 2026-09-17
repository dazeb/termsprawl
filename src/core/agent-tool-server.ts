import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_TOOLS, TOOL_GUIDES, validateToolRequest, type IntegrationStatus, type ToolIdentity, type ToolRequest } from './agent-tools'

export interface ToolSession extends ToolIdentity {
  token: string
  status: IntegrationStatus
}
export interface ToolEndpoint { url: string; instanceId: string }

export function privateJson(path: string, value: unknown): void {
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

/** Per-app authenticated transport. Tokens survive app restarts, never node deletion. */
export class AgentToolServer {
  readonly directory: string
  readonly instanceId = randomUUID()
  private server?: Server
  private sessions = new Map<string, ToolSession>()
  private queues = new Map<string, Promise<unknown>>()
  private endpoint?: ToolEndpoint
  private ownsLock = false

  constructor(userDataPath: string, private readonly options: {
    execute(identity: ToolIdentity, request: ToolRequest): Promise<unknown>
    valid(identity: ToolIdentity): boolean
    browserEnabled(): boolean
    appVersion?: string
    onStatus?(nodeId: string, status: IntegrationStatus): void
  }) {
    this.directory = join(userDataPath, 'agent-tools')
    mkdirSync(join(this.directory, 'sessions'), { recursive: true, mode: 0o700 })
    chmodSync(this.directory, 0o700)
  }

  sessionFile(nodeId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(nodeId)) throw new Error('Invalid agent node ID')
    return join(this.directory, 'sessions', `${nodeId}.json`)
  }

  provision(identity: ToolIdentity, status: IntegrationStatus, reuse: boolean): ToolSession {
    const file = this.sessionFile(identity.nodeId)
    let session: ToolSession | undefined
    if (reuse) {
      try {
        const previous = JSON.parse(readFileSync(file, 'utf8')) as ToolSession
        if (previous.nodeId === identity.nodeId && previous.projectId === identity.projectId && /^[a-f0-9]{64}$/.test(previous.token)) session = previous
      } catch { /* A legacy warm session needs a restart to inherit configuration. */ }
    }
    session ??= { ...identity, token: randomBytes(32).toString('hex'), status }
    if (!reuse) session.status = status
    this.sessions.set(identity.nodeId, session)
    privateJson(file, session)
    this.options.onStatus?.(identity.nodeId, session.status)
    return session
  }

  hasCredentials(nodeId: string): boolean {
    try { return /^[a-f0-9]{64}$/.test(JSON.parse(readFileSync(this.sessionFile(nodeId), 'utf8')).token) } catch { return false }
  }

  statuses(projectId: string): Array<ToolIdentity & { status: IntegrationStatus }> {
    return [...this.sessions.values()].filter((s) => s.projectId === projectId && this.options.valid(s))
      .map(({ nodeId, projectId, status }) => ({ nodeId, projectId, status }))
  }

  revoke(nodeId: string): void {
    this.sessions.delete(nodeId)
    rmSync(this.sessionFile(nodeId), { force: true })
  }

  async invoke(session: ToolSession, raw: unknown): Promise<unknown> {
    const request = validateToolRequest(raw)
    if (!this.options.valid(session)) throw new Error('Agent node no longer belongs to this project')
    if (request.operation === 'session_info') {
      if (session.status.adapter === 'claude-mcp' || session.status.adapter === 'codex-mcp') {
        session.status = { ...session.status, state: 'connected', reason: 'Authenticated tool connection established' }
        this.options.onStatus?.(session.nodeId, session.status)
      }
      return { nodeId: session.nodeId, projectId: session.projectId, instanceId: this.instanceId, host: 'local', status: session.status,
        appVersion: this.options.appVersion ?? 'development', preferencesFile: join(this.directory, 'preferences.json'), guidesDirectory: join(this.directory, 'launch', session.nodeId, 'skills'),
        browserEnabled: this.options.browserEnabled(), operations: AGENT_TOOLS.filter((t) => this.options.browserEnabled() || !t.name.startsWith('browser_')).map((t) => t.name) }
    }
    if (request.operation === 'guide_read') return TOOL_GUIDES[String(request.args.topic)]
    if (request.operation === 'agent_status') return this.statuses(session.projectId)
    if (request.operation.startsWith('browser_') && !this.options.browserEnabled()) throw new Error('Enable agent browser control in Settings first')
    // Serialize a project's operations, including ownership transfers and canvas writes.
    const previous = this.queues.get(session.projectId) ?? Promise.resolve()
    const expiresAt = Date.now() + 15_000
    const work = previous.catch(() => {}).then(() => {
      if (Date.now() > expiresAt) throw new Error('Queued operation expired before execution; no change applied')
      if (this.sessions.get(session.nodeId)?.token !== session.token || !this.options.valid(session)) throw new Error('Session revoked')
      if (request.operation.startsWith('browser_') && !this.options.browserEnabled()) throw new Error('Browser control was disabled while waiting')
      return this.options.execute({ nodeId: session.nodeId, projectId: session.projectId }, request)
    })
    this.queues.set(session.projectId, work)
    try { return await work } finally { if (this.queues.get(session.projectId) === work) this.queues.delete(session.projectId) }
  }

  async start(): Promise<void> {
    const lock = join(this.directory, 'server.lock')
    if (this.server) throw new Error('Tool service already started')
    try {
      const owner = JSON.parse(readFileSync(lock, 'utf8')) as { pid: number }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid service lock')
      let alive = true
      try { process.kill(owner.pid, 0) } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
      if (alive) throw new Error('Another termsprawl tool service is already using this data directory')
      rmSync(lock)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const fd = openSync(lock, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, instanceId: this.instanceId })) } finally { closeSync(fd) }
    this.ownsLock = true
    this.server = createServer(async (req, res) => {
      const reply = (status: number, body: unknown): void => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.headers.origin || req.method !== 'POST' || req.url !== '/call') { reply(403, { ok: false, error: 'Unsupported request' }); return }
      const supplied = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''))
      const session = [...this.sessions.values()].find((s) => {
        const expected = Buffer.from(s.token)
        return supplied.length === expected.length && timingSafeEqual(supplied, expected)
      })
      if (!session) { reply(401, { ok: false, error: 'Unknown or revoked session' }); return }
      try {
        let bytes = 0
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 128 * 1024) throw new Error('Request too large')
          chunks.push(Buffer.from(chunk))
        }
        const value = await this.invoke(session, JSON.parse(Buffer.concat(chunks).toString('utf8')))
        reply(200, { ok: true, value })
      } catch (error) { reply(400, { ok: false, error: error instanceof Error ? error.message : 'Tool failed' }) }
    })
    this.server.requestTimeout = 15_000
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Tool server did not bind')
    this.endpoint = { url: `http://127.0.0.1:${address.port}/call`, instanceId: this.instanceId }
    privateJson(join(this.directory, 'endpoint.json'), this.endpoint)
  }

  async close(): Promise<void> {
    try {
      const stored = JSON.parse(readFileSync(join(this.directory, 'endpoint.json'), 'utf8'))
      if (stored.instanceId === this.instanceId) rmSync(join(this.directory, 'endpoint.json'), { force: true })
    } catch { /* Already removed. */ }
    await new Promise<void>((resolve) => { if (!this.server) resolve(); else { this.server.close(() => resolve()); this.server.closeAllConnections() } })
    if (this.ownsLock) { rmSync(join(this.directory, 'server.lock'), { force: true }); this.ownsLock = false }
  }
}
