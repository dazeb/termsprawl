// cloud.test.ts — cloud runtime session persistence (electron mocked).
//
// The session cookie used to live only in a closure variable, so every app
// restart forgot the GitHub-backed sign-in and forced the device flow again.
// These tests pin the userData-backed mirror: written on sign-in, restored on
// the next runtime (0600), removed on sign-out.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceSnapshot } from '@shared/types'

const h = vi.hoisted(() => ({ userDir: '' }))

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
  app: { getPath: (_name: string) => h.userDir },
}))

import { createCloudRuntime } from './cloud'

interface FakeRoute {
  status?: number
  body?: unknown
  setCookie?: string
}

/** Fetch stub: one route list matched in order; records every call's headers. */
function fetchMock(routes: Array<FakeRoute & { match: RegExp }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> })
    const route = routes.find((r) => r.match.test(u))
    if (!route) throw new Error(`unexpected fetch: ${u}`)
    const headers = new Headers()
    if (route.setCookie) headers.set('set-cookie', route.setCookie)
    return new Response(route.body === undefined ? '{}' : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers,
    })
  })
  return { fn, calls }
}

const noopSnapshot = (): WorkspaceSnapshot => ({}) as WorkspaceSnapshot

beforeEach(() => {
  h.userDir = mkdtempSync(join(tmpdir(), 'termsprawl-cloud-test-'))
})

describe('cloud runtime session persistence', () => {
  it('restores the session cookie from userData in a new runtime', async () => {
    // First runtime: a device-flow poll captures the Set-Cookie.
    const first = fetchMock([
      { match: /auth\/device/, body: { status: 'pending' }, setCookie: 'ts_session=abc123; HttpOnly; Path=/' },
    ])
    const runtime1 = createCloudRuntime({ apiBase: 'https://cloud.test', fetchFn: first.fn, snapshot: noopSnapshot })
    await runtime1.devicePoll('dc-1')

    const sessionFile = join(h.userDir, 'cloud-session')
    expect(existsSync(sessionFile)).toBe(true)
    expect(readFileSync(sessionFile, 'utf8')).toContain('ts_session=abc123')
    // Secret file: owner-only permissions.
    expect(statSync(sessionFile).mode & 0o777).toBe(0o600)

    // Second runtime over the SAME userData: sends the restored cookie.
    const second = fetchMock([
      { match: /\/me/, body: { id: 'u1' } },
      { match: /auth\/logout/, body: {} },
    ])
    const runtime2 = createCloudRuntime({ apiBase: 'https://cloud.test', fetchFn: second.fn, snapshot: noopSnapshot })
    const user = await runtime2.getUser()
    expect(user).toEqual({ id: 'u1' })
    const authed = second.calls.find((c) => /\/me/.test(c.url))
    expect(authed?.headers['Cookie']).toBe('ts_session=abc123')
    await runtime2.signOut() // stop the backup poller the getUser started
  })

  it('sign-out removes the persisted session file', async () => {
    const login = fetchMock([
      { match: /auth\/device/, body: { status: 'pending' }, setCookie: 'ts_session=abc123; HttpOnly; Path=/' },
      { match: /auth\/logout/, body: {} },
    ])
    const runtime = createCloudRuntime({ apiBase: 'https://cloud.test', fetchFn: login.fn, snapshot: noopSnapshot })
    await runtime.devicePoll('dc-1')
    expect(existsSync(join(h.userDir, 'cloud-session'))).toBe(true)

    await runtime.signOut()
    expect(existsSync(join(h.userDir, 'cloud-session'))).toBe(false)

    // A fresh runtime starts signed out — no Cookie header at all.
    const after = fetchMock([{ match: /\/me/, status: 401, body: { error: { code: 'unauthorized' } } }])
    const runtime2 = createCloudRuntime({ apiBase: 'https://cloud.test', fetchFn: after.fn, snapshot: noopSnapshot })
    // getUser maps 401 to null (signed out) rather than rejecting.
    await expect(runtime2.getUser()).resolves.toBeNull()
    const me = after.calls.find((c) => /\/me/.test(c.url))
    expect(me?.headers['Cookie']).toBeUndefined()
  })
})
