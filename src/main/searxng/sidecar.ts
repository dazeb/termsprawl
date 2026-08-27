// src/main/searxng/sidecar.ts — the local SearXNG search sidecar (Phase 14).
//
// Electron-free by design (node only): the app spawns the vendored searxng
// venv python as a child process — the same sidecar model as tmux — binds it
// to 127.0.0.1 on a random high port, waits for /healthz, and kills it on
// quit. Main (index.ts) wires the runtime path + renderer broadcasts.
//
// Lifecycle: idle → starting → ready(port) | failed(reason) → stopped.
// Crash (child exits while 'ready') broadcasts 'stopped' so the renderer can
// degrade to the fallback home URL. A leftover pid file from a previous
// session whose instance still answers /healthz is ADOPTED (crash recovery);
// a stale one is cleaned up and a fresh instance started.

import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  generateSearxngSettings,
  generateSecretKey,
  pickFreePort,
  searxngHealthUrl
} from '../../core/searxng-config'
import type { SearxngInfo, SearxngStatus, SearchResult } from '../../shared/types'

export interface SearxngSidecarDeps {
  /** userData dir — sidecar state (settings.yml, secret, pid, log) lives here. */
  userDataPath: string
  /** Directory containing venv/bin/python + src (the vendored runtime). */
  runtimePath: string
  /** Emits lifecycle changes to the renderer (main wires this to the window). */
  broadcast?: (info: SearxngInfo) => void
  /** Injectable for tests. */
  spawnFn?: typeof spawn
  fetchFn?: typeof fetch
  healthIntervalMs?: number
  healthTimeoutMs?: number
  killGraceMs?: number
  searchTimeoutMs?: number
}

const DEFAULT_HEALTH_INTERVAL_MS = 500
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000
const DEFAULT_KILL_GRACE_MS = 3_000
const DEFAULT_SEARCH_TIMEOUT_MS = 10_000
const SECRET_LENGTH = 64

interface PersistedState {
  port?: number
}

export class SearxngSidecar {
  private status: SearxngStatus = 'idle'
  private port: number | undefined
  private reason: string | undefined
  private child: ChildProcess | null = null
  private starting: Promise<SearxngInfo> | null = null
  private stoppedByUs = false

  constructor(private readonly deps: SearxngSidecarDeps) {}

  private get dir(): string {
    return join(this.deps.userDataPath, 'searxng')
  }

  private get settingsPath(): string {
    return join(this.dir, 'settings.yml')
  }

  private get secretPath(): string {
    return join(this.dir, 'secret')
  }

  private get pidPath(): string {
    return join(this.dir, 'pid')
  }

  private get statePath(): string {
    return join(this.dir, 'state.json')
  }

  private get logPath(): string {
    return join(this.dir, 'searxng.log')
  }

  private get pythonPath(): string {
    return join(this.deps.runtimePath, 'venv', 'bin', 'python')
  }

  private emit(): void {
    this.deps.broadcast?.(this.info())
  }

  info(): SearxngInfo {
    const info: SearxngInfo = { status: this.status }
    if (this.port !== undefined) {
      info.port = this.port
      info.baseUrl = `http://127.0.0.1:${this.port}`
    }
    if (this.reason !== undefined) info.reason = this.reason
    return info
  }

  private setStatus(status: SearxngStatus, reason?: string): void {
    this.status = status
    if (reason !== undefined) this.reason = reason
    this.emit()
  }

  private persistState(): void {
    mkdirSync(this.dir, { recursive: true })
    const state: PersistedState = {}
    if (this.port !== undefined) state.port = this.port
    writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  /** Lazy start (idempotent): the first caller wins; concurrent callers share
   * the in-flight start promise. */
  ensureSearxng(): Promise<SearxngInfo> {
    if (this.status === 'ready') return Promise.resolve(this.info())
    if (this.starting) return this.starting
    this.starting = this.start()
      .finally(() => {
        this.starting = null
      })
    return this.starting
  }

  private async start(): Promise<SearxngInfo> {
    this.setStatus('starting')

    // Adopt-or-kill: a live instance from a previous session (pid file +
    // health check on the recorded port) is reused; a stale pid file is
    // removed so a fresh spawn can take the port.
    if (existsSync(this.pidPath)) {
      const adopted = await this.tryAdopt()
      if (adopted) return this.info()
      try {
        unlinkSync(this.pidPath)
      } catch {
        /* best effort */
      }
    }

    if (!existsSync(this.pythonPath)) {
      this.setStatus('failed', 'runtime-missing')
      return this.info()
    }

    const fetchFn = this.deps.fetchFn ?? fetch
    const interval = this.deps.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS
    const timeout = this.deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS

    const port = await pickFreePort()
    this.port = port

    // Reuse the secret across restarts so limiter/cookie state stays stable.
    let secret = ''
    try {
      secret = readFileSync(this.secretPath, 'utf8').trim()
    } catch {
      /* first run */
    }
    if (secret.length < SECRET_LENGTH) {
      secret = generateSecretKey()
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(this.secretPath, secret, 'utf8')
    }

    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.settingsPath, generateSearxngSettings(port, secret), 'utf8')
    this.persistState()

    const spawnFn = this.deps.spawnFn ?? spawn
    const logFd = openSync(this.logPath, 'a')
    const env = {
      ...process.env,
      SEARXNG_SETTINGS_PATH: this.settingsPath,
      SEARXNG_DEBUG: '0'
    }
    const child = spawnFn(this.pythonPath, ['-m', 'searx.webapp'], {
      env,
      cwd: this.dir,
      stdio: ['ignore', logFd, logFd]
    })
    this.child = child
    this.stoppedByUs = false
    child.on('exit', () => {
      try {
        closeSync(logFd)
      } catch {
        /* already closed */
      }
      if (this.status === 'ready' && !this.stoppedByUs) {
        // Crashed after being healthy — surface it so the UI can fall back.
        this.setStatus('stopped')
      }
    })

    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (this.stoppedByUs) {
        this.setStatus('stopped')
        return this.info()
      }
      try {
        const res = await fetchFn(searxngHealthUrl(port), { signal: AbortSignal.timeout(interval) })
        if (res.ok) {
          try {
            writeFileSync(this.pidPath, `${child.pid ?? ''}\n`, 'utf8')
          } catch {
            /* best effort */
          }
          this.setStatus('ready')
          return this.info()
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, interval))
    }

    this.killChild()
    this.setStatus('failed', 'health-timeout')
    return this.info()
  }

  private async tryAdopt(): Promise<boolean> {
    let port: number | undefined
    try {
      const state = JSON.parse(readFileSync(this.statePath, 'utf8')) as PersistedState
      port = typeof state.port === 'number' ? state.port : undefined
    } catch {
      return false
    }
    if (port === undefined) return false
    const fetchFn = this.deps.fetchFn ?? fetch
    try {
      const res = await fetchFn(searxngHealthUrl(port), { signal: AbortSignal.timeout(3_000) })
      if (!res.ok) return false
    } catch {
      return false
    }
    this.port = port
    this.setStatus('ready')
    return true
  }

  private killChild(): void {
    const child = this.child
    if (!child) return
    this.stoppedByUs = true
    child.kill('SIGTERM')
    const grace = this.deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    setTimeout(() => {
      if (this.child === child) child.kill('SIGKILL')
    }, grace).unref()
  }

  /** Terminate the sidecar (app quit). Idempotent. */
  async stop(): Promise<void> {
    if (this.child) {
      this.killChild()
      this.child = null
    }
    for (const p of [this.pidPath]) {
      try {
        unlinkSync(p)
      } catch {
        /* best effort */
      }
    }
    this.setStatus('stopped')
  }

  /** Keyless JSON search against the local instance (14.4). Returns [] when
   * the sidecar can't start or the engine responds badly — never throws to
   * callers; the app must keep working without local search. */
  async query(q: string): Promise<SearchResult[]> {
    const info = await this.ensureSearxng()
    if (info.status !== 'ready' || info.port === undefined) return []
    const fetchFn = this.deps.fetchFn ?? fetch
    const timeout = this.deps.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
    const url = `http://127.0.0.1:${info.port}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeout) })
      if (!res.ok) return []
      const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> }
      return (data.results ?? [])
        .filter((r) => typeof r.title === 'string' && typeof r.url === 'string')
        .slice(0, 10)
        .map((r) => ({ title: r.title as string, url: r.url as string, content: (r.content ?? '') as string }))
    } catch {
      return []
    }
  }
}
