// Container boot gate (space defense-in-depth).
//
// Inside a hosted space container the router authenticates every request and
// re-injects the deterministic shared secret (sha256 hex of
// `${SPACE_JWT_SECRET}:${login}`) as the `X-Termsprawl-Space` header. The
// container only serves the WS boot token (/termsprawl-boot.js) when that
// header matches its own TERMSPRAWL_SPACE_HEADER env, so a direct hit on the
// app port from a shared bridge can never download the token. A plain offline
// Server Edition (no env) serves boot.js as today. Only /termsprawl-boot.js is
// gated; '/' (the page shell + health-probe target) stays open.

import { request as httpRequest, type IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './index'

// A plausible router-minted shared secret (lowercase hex). The container only
// compares it timing-safely, so its exact shape is not asserted here.
const HEADER_SECRET = 'ab'.repeat(24) // 48 lowercase hex chars

type App = Awaited<ReturnType<typeof createApp>>

/** Boot a full server on an ephemeral loopback port (createApp does not bind). */
async function boot(): Promise<{ app: App; port: number }> {
  const app = await createApp()
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const addr = app.server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return { app, port }
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res: IncomingMessage) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('container /termsprawl-boot.js gate', () => {
  let app: App | null = null

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (app) {
      try { await app.close() } catch { /* best-effort */ }
      app = null
    }
  })

  it('serves the boot token to a matching X-Termsprawl-Space request when the env is set', async () => {
    vi.stubEnv('TERMSPRAWL_SPACE_HEADER', HEADER_SECRET)
    const booted = await boot()
    app = booted.app
    const res = await get(booted.port, '/termsprawl-boot.js', { 'X-Termsprawl-Space': HEADER_SECRET })
    expect(res.status).toBe(200)
    expect(res.body).toContain('window.__TERMPRAWL_WS_TOKEN')
  })

  it('refuses the boot token without the header when the env is set', async () => {
    vi.stubEnv('TERMSPRAWL_SPACE_HEADER', HEADER_SECRET)
    const booted = await boot()
    app = booted.app
    const res = await get(booted.port, '/termsprawl-boot.js')
    expect(res.status).toBe(401)
    expect(res.body).toBe('router required')
    expect(res.body).not.toContain('window.__TERMPRAWL_WS_TOKEN')
  })

  it('refuses the boot token with a wrong header when the env is set', async () => {
    vi.stubEnv('TERMSPRAWL_SPACE_HEADER', HEADER_SECRET)
    const booted = await boot()
    app = booted.app
    const res = await get(booted.port, '/termsprawl-boot.js', { 'X-Termsprawl-Space': 'f'.repeat(48) })
    expect(res.status).toBe(401)
    expect(res.body).toBe('router required')
  })

  it('leaves the page shell open so health probes still pass when the env is set', async () => {
    vi.stubEnv('TERMSPRAWL_SPACE_HEADER', HEADER_SECRET)
    const booted = await boot()
    app = booted.app
    const res = await get(booted.port, '/')
    expect(res.status).toBe(200)
    // The shell references boot.js, but a direct hit gets the 401 body there,
    // never the token — the inert shell leaks nothing.
    expect(res.body).toContain('<head>')
    expect(res.body).not.toContain('window.__TERMPRAWL_WS_TOKEN')
  })

  it('serves the boot token without the header when no space env is set (offline local dev)', async () => {
    const booted = await boot()
    app = booted.app
    const res = await get(booted.port, '/termsprawl-boot.js')
    expect(res.status).toBe(200)
    expect(res.body).toContain('window.__TERMPRAWL_WS_TOKEN')
  })
})
