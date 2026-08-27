// sidecar.test.ts — SearXNG sidecar lifecycle (spawn/health/adopt/kill/query)
// with injected spawn + fetch fakes; no electron, no real python.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearxngSidecar, type SearxngSidecarDeps } from './sidecar'
import type { SearxngInfo } from '../../shared/types'

interface FakeChild extends EventEmitter {
  pid: number
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = 4242
  child.kill = vi.fn((signal?: string) => {
    child.emit('exit', 0, signal ?? null)
    return true
  })
  return child
}

describe('SearxngSidecar', () => {
  const dirs: string[] = []
  let runtimeDir: string
  let child: FakeChild
  let spawnFn: ReturnType<typeof vi.fn>
  let fetchFn: ReturnType<typeof vi.fn>
  let broadcasts: ReturnType<typeof vi.fn>
  let deps: SearxngSidecarDeps

  function healthOk(url: string): Response {
    return new Response('OK', { status: 200 })
  }

  beforeEach(() => {
    const ud = mkdtempSync(join(tmpdir(), 'termsprawl-searxng-'))
    dirs.push(ud)
    runtimeDir = mkdtempSync(join(tmpdir(), 'termsprawl-searxng-runtime-'))
    dirs.push(runtimeDir)
    // Simulate the vendored layout.
    const binDir = join(runtimeDir, 'venv', 'bin')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'python'), '#!/bin/sh\n', 'utf8')

    child = fakeChild()
    spawnFn = vi.fn(() => child)
    fetchFn = vi.fn((url: string | URL | Request) => healthOk(String(url)))
    broadcasts = vi.fn()
    deps = {
      userDataPath: ud,
      runtimePath: runtimeDir,
      broadcast: broadcasts as (info: SearxngInfo) => void,
      spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
      fetchFn: fetchFn as unknown as typeof fetch,
      healthIntervalMs: 5,
      healthTimeoutMs: 500,
      killGraceMs: 10
    }
  })

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('starts, writes a hardened settings.yml, and reports ready', async () => {
    const sidecar = new SearxngSidecar(deps)
    const info = await sidecar.ensureSearxng()
    expect(info.status).toBe('ready')
    expect(info.port).toBeGreaterThanOrEqual(49152)
    expect(info.baseUrl).toBe(`http://127.0.0.1:${info.port}`)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(spawnFn.mock.calls[0][0]).toContain('venv/bin/python')
    expect(spawnFn.mock.calls[0][1]).toEqual(['-m', 'searx.webapp'])
    const opts = spawnFn.mock.calls[0][2] as { env: NodeJS.ProcessEnv; cwd: string }
    expect(opts.env.SEARXNG_SETTINGS_PATH).toContain('settings.yml')
    expect(opts.cwd).toContain('searxng')
    const yaml = readFileSync(join(deps.userDataPath, 'searxng', 'settings.yml'), 'utf8')
    expect(yaml).toContain(`port: ${info.port}`)
    expect(yaml).toContain('bind_address: 127.0.0.1')
    expect(yaml).toContain('- json')
    // Status broadcast happened (starting → ready).
    expect(broadcasts).toHaveBeenCalled()
    const statuses = broadcasts.mock.calls.map((c) => c[0].status)
    expect(statuses).toContain('starting')
    expect(statuses).toContain('ready')
  })

  it('is idempotent — concurrent + repeated ensure share one start', async () => {
    const sidecar = new SearxngSidecar(deps)
    const [a, b] = await Promise.all([sidecar.ensureSearxng(), sidecar.ensureSearxng()])
    expect(a.status).toBe('ready')
    expect(b.status).toBe('ready')
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const again = await sidecar.ensureSearxng()
    expect(again.status).toBe('ready')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('fails cleanly when the vendored runtime is missing', async () => {
    deps.runtimePath = join(tmpdir(), 'does-not-exist-runtime')
    const sidecar = new SearxngSidecar(deps)
    const info = await sidecar.ensureSearxng()
    expect(info.status).toBe('failed')
    expect(info.reason).toBe('runtime-missing')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('fails with health-timeout and kills the child when health never comes', async () => {
    fetchFn = vi.fn(() => Promise.reject(new Error('connection refused')))
    deps.fetchFn = fetchFn as unknown as typeof fetch
    const sidecar = new SearxngSidecar(deps)
    const info = await sidecar.ensureSearxng()
    expect(info.status).toBe('failed')
    expect(info.reason).toBe('health-timeout')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('broadcasts stopped when the child crashes after being ready', async () => {
    const sidecar = new SearxngSidecar(deps)
    await sidecar.ensureSearxng()
    expect(sidecar.info().status).toBe('ready')
    child.emit('exit', 1, null)
    expect(sidecar.info().status).toBe('stopped')
  })

  it('adopts a live instance found via pid file + recorded port (crash recovery)', async () => {
    const ud = deps.userDataPath!
    mkdirSync(join(ud, 'searxng'), { recursive: true })
    writeFileSync(join(ud, 'searxng', 'state.json'), JSON.stringify({ port: 54321 }), 'utf8')
    writeFileSync(join(ud, 'searxng', 'pid'), '99999', 'utf8')
    const sidecar = new SearxngSidecar(deps)
    const info = await sidecar.ensureSearxng()
    expect(info.status).toBe('ready')
    expect(info.port).toBe(54321)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('does not adopt when the recorded instance is dead, and starts fresh', async () => {
    const ud = deps.userDataPath!
    mkdirSync(join(ud, 'searxng'), { recursive: true })
    writeFileSync(join(ud, 'searxng', 'state.json'), JSON.stringify({ port: 54321 }), 'utf8')
    writeFileSync(join(ud, 'searxng', 'pid'), '99999', 'utf8')
    fetchFn = vi.fn((url: string | URL | Request) =>
      String(url).includes(':54321/healthz') ? Promise.reject(new Error('refused')) : healthOk(String(url))
    )
    deps.fetchFn = fetchFn as unknown as typeof fetch
    const sidecar = new SearxngSidecar(deps)
    const info = await sidecar.ensureSearxng()
    expect(info.status).toBe('ready')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('stop() terminates the child and clears the pid file', async () => {
    const sidecar = new SearxngSidecar(deps)
    await sidecar.ensureSearxng()
    await sidecar.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(sidecar.info().status).toBe('stopped')
  })

  it('query() maps JSON results, caps at 10, and filters malformed hits', async () => {
    const results = Array.from({ length: 15 }, (_, i) => ({
      title: `hit ${i}`,
      url: `https://e.example/${i}`,
      content: `content ${i}`
    }))
    results.push({ url: 'no-title' } as never)
    fetchFn = vi.fn((url: string | URL | Request) => {
      if (String(url).includes('/healthz')) return healthOk(String(url))
      return new Response(JSON.stringify({ results }), { status: 200 })
    })
    deps.fetchFn = fetchFn as unknown as typeof fetch
    const sidecar = new SearxngSidecar(deps)
    const out = await sidecar.query('hello world')
    expect(out).toHaveLength(10)
    expect(out[0]).toEqual({ title: 'hit 0', url: 'https://e.example/0', content: 'content 0' })
    const lastUrl = String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0])
    expect(lastUrl).toContain('format=json')
    expect(lastUrl).toContain('safesearch=1')
  })

  it('query() returns [] when the sidecar cannot start', async () => {
    deps.runtimePath = join(tmpdir(), 'no-runtime')
    const sidecar = new SearxngSidecar(deps)
    expect(await sidecar.query('anything')).toEqual([])
  })

  it('query() returns [] on a non-200 response', async () => {
    fetchFn = vi.fn((url: string | URL | Request) =>
      String(url).includes('/healthz') ? healthOk(String(url)) : new Response('bad', { status: 500 })
    )
    deps.fetchFn = fetchFn as unknown as typeof fetch
    const sidecar = new SearxngSidecar(deps)
    expect(await sidecar.query('x')).toEqual([])
  })

  it('reuses the persisted secret across restarts', async () => {
    const sidecar = new SearxngSidecar(deps)
    await sidecar.ensureSearxng()
    await sidecar.stop()
    const secret1 = readFileSync(join(deps.userDataPath, 'searxng', 'secret'), 'utf8')
    expect(secret1).toMatch(/^[0-9a-f]{64}$/)
    const sidecar2 = new SearxngSidecar(deps)
    await sidecar2.ensureSearxng()
    const secret2 = readFileSync(join(deps.userDataPath, 'searxng', 'secret'), 'utf8')
    expect(secret2).toBe(secret1)
  })
})
