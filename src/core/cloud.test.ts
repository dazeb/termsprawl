import { describe, expect, it, vi } from 'vitest'
import { CloudClient, CloudError } from './cloud'
import type { CloudBackup, CloudUser } from '../shared/types'

const ORIGIN = 'http://127.0.0.1:8787'
const USER: CloudUser = {
  id: 'u1',
  github_login: 'dazeb',
  name: 'Dazeb',
  email: 'daz@dazeb.dev',
  avatar_url: '',
  plan: 'free',
  created_at: '2026-08-24T00:00:00Z',
}
const BACKUP: CloudBackup = { id: 'bk1', project: '~/p', size_bytes: 37, created_at: '2026-08-24T00:00:00Z', status: 'ok' }

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('CloudClient', () => {
  it('oauthStartUrl() points at the GitHub authorize endpoint', () => {
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn: vi.fn() as unknown as typeof fetch, keepCookie: () => {}, getCookie: () => null })
    expect(client.oauthStartUrl()).toBe(`${ORIGIN}/api/v1/auth/github`)
  })

  it('exchangeCode() POSTs the code and stores the session cookie', async () => {
    const stored: { value: string | null } = { value: null }
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/auth/github`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'github-code-1' })
      return new Response(null, {
        status: 204,
        headers: { 'set-cookie': 'ts_session=abc123; HttpOnly; SameSite=Lax; Path=/; Max-Age=100' },
      })
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: (c) => (stored.value = c), getCookie: () => null })
    await client.exchangeCode('github-code-1')
    expect(stored.value?.startsWith('ts_session=abc123')).toBe(true)
  })

  it('me() sends the session cookie and returns the user; 401 surfaces as unauthorized', async () => {
    let sentCookie: string | null = null
    const okFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      return jsonResponse(USER, 200)
    })
    const okClient = new CloudClient({ apiBase: ORIGIN, fetchFn: okFetch, keepCookie: () => {}, getCookie: () => 'ts_session=abc123' })
    const me = await okClient.me()
    expect(me.github_login).toBe('dazeb')
    expect(sentCookie).toBe('ts_session=abc123')

    const unauthFetch = vi.fn(async () => jsonResponse({ error: { code: 'unauthorized', message: 'Sign in to continue' } }, 401))
    const unauthClient = new CloudClient({ apiBase: ORIGIN, fetchFn: unauthFetch, keepCookie: () => {}, getCookie: () => null })
    let thrown: unknown
    try {
      await unauthClient.me()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(CloudError)
    expect(CloudClient.isUnauthorized(thrown)).toBe(true)
  })

  it('createBackup() posts the workspace payload; listBackups() returns history', async () => {
    const posted: unknown[] = []
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (path === '/api/v1/backups' && (init?.method ?? '').toUpperCase() === 'POST') {
        posted.push(JSON.parse(String(init?.body)))
        return jsonResponse(BACKUP, 201)
      }
      if (path === '/api/v1/backups' && (init?.method ?? 'GET').toUpperCase() !== 'POST') {
        return jsonResponse([BACKUP], 200)
      }
      throw new Error('unexpected request: ' + url + ' ' + init?.method)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const created = await client.createBackup({ project: '~/p', name: 'auto', workspace: { rev: 42 }, files: { 'project.json': { nodes: [] } } })
    expect(created.status).toBe('ok')
    expect(posted[0]).toMatchObject({ project: '~/p', name: 'auto', workspace: { rev: 42 } })
    const list = (await client.listBackups()) as CloudBackup[]
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('bk1')
  })
})
