import { describe, expect, it, vi } from 'vitest'
import { CloudClient, CloudError, spaceOpenUrl } from './cloud'
import type { CloudSpace } from '../shared/types'

const ORIGIN = 'http://127.0.0.1:8787'
const SPACE: CloudSpace = {
  login: 'dazeb',
  status: 'running',
  url: 'https://canvas.termsprawl.com/dazeb',
  lastActiveAt: '2026-08-30T00:00:00Z',
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('CloudClient spaces (online canvas)', () => {
  it('getSpace() GETs /spaces/mine with the session cookie and unwraps { space }', async () => {
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces/mine`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      return jsonResponse({ space: SPACE }, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const space = await client.getSpace()
    expect(sentCookie).toBe('ts_session=x')
    expect(space).toEqual(SPACE)
  })

  it('getSpace() returns null when the user has no space yet', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ space: null }, 200))
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(client.getSpace()).resolves.toBeNull()
  })

  it('provisionSpace() POSTs /spaces and returns the space (login, url, status)', async () => {
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('POST')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      return jsonResponse({ login: SPACE.login, url: SPACE.url, status: 'provisioning' }, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const space = await client.provisionSpace()
    expect(sentCookie).toBe('ts_session=x')
    expect(space.login).toBe('dazeb')
    expect(space.url).toBe(SPACE.url)
    expect(space.status).toBe('provisioning')
  })

  it('provisionSpace() surfaces 403 upgrade_required (free plan) as a CloudError', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'upgrade_required', message: 'Upgrade to Pro to get an online canvas' } }, 403)
    )
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    let thrown: unknown
    try {
      await client.provisionSpace()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(CloudError)
    const err = thrown as CloudError
    expect(err.status).toBe(403)
    expect(err.code).toBe('upgrade_required')
    expect(err.message).toBe('Upgrade to Pro to get an online canvas')
  })

  it('spaceAccessToken() POSTs /spaces/access and returns { token, url }', async () => {
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces/access`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('POST')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      return jsonResponse({ token: 'jwt-a.b.c', url: SPACE.url }, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const access = await client.spaceAccessToken()
    expect(sentCookie).toBe('ts_session=x')
    expect(access.token).toBe('jwt-a.b.c')
    expect(access.url).toBe(SPACE.url)
  })

  it('spaceAccessToken() surfaces 404 no_space (nothing provisioned) as a CloudError', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'no_space', message: 'No space provisioned yet' } }, 404)
    )
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    let thrown: unknown
    try {
      await client.spaceAccessToken()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(CloudError)
    expect((thrown as CloudError).code).toBe('no_space')
  })
})

describe('spaceOpenUrl', () => {
  it('appends the access token as the ?t= query param the space-router validates', () => {
    const out = spaceOpenUrl('https://canvas.termsprawl.com/dazeb', 'jwt-a.b.c')
    expect(out).toBe('https://canvas.termsprawl.com/dazeb?t=jwt-a.b.c')
  })

  it('preserves the path and existing query params', () => {
    const out = spaceOpenUrl('https://canvas.termsprawl.com/dazeb?x=1', 'jwt-tok')
    expect(out).toBe('https://canvas.termsprawl.com/dazeb?x=1&t=jwt-tok')
  })

  it('leaves a malformed URL untouched instead of throwing into the UI', () => {
    expect(spaceOpenUrl('not a url', 'jwt-tok')).toBe('not a url')
  })
})
