import { describe, expect, it, vi } from 'vitest'
import { CloudClient, CloudError, spaceOpenUrl } from './cloud'
import { buildBundle, type WorkspaceBundle } from './workspace-bundle'
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

  it('pullSpaceContent() GETs /spaces/pull with the session cookie and returns the snapshot', async () => {
    const snapshot = {
      workspace: { index: { projects: [{ id: 'p1', name: 'main', cwd: null }] }, projects: {} },
      files: {},
      scrollbacks: { 'term-1': 'session restored\n$ ls\n' },
    }
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces/pull`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      return jsonResponse(snapshot, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const pulled = await client.pullSpaceContent()
    expect(sentCookie).toBe('ts_session=x')
    expect(pulled).toEqual(snapshot)
  })

  it('pullSpaceContent() maps 404 no_content to null (nothing online yet)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'no_content', message: 'No snapshot yet' } }, 404)
    )
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(client.pullSpaceContent()).resolves.toBeNull()
  })

  it('pullSpaceContent() keeps other 404 codes as errors and surfaces 403 upgrade_required', async () => {
    const otherCode = vi.fn(async () =>
      jsonResponse({ error: { code: 'no_space', message: 'No space provisioned yet' } }, 404)
    )
    const otherClient = new CloudClient({ apiBase: ORIGIN, fetchFn: otherCode, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(otherClient.pullSpaceContent()).rejects.toMatchObject({ code: 'no_space' })

    const upgrade = vi.fn(async () =>
      jsonResponse({ error: { code: 'upgrade_required', message: 'Upgrade to Pro' } }, 403)
    )
    const proClient = new CloudClient({ apiBase: ORIGIN, fetchFn: upgrade, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(proClient.pullSpaceContent()).rejects.toMatchObject({ status: 403, code: 'upgrade_required' })
  })

  it('pushSpaceContent() POSTs the snapshot payload to /spaces/push and returns { ok, bytes }', async () => {
    const payload = {
      workspace: {
        index: { projects: [{ id: 'p1', name: 'main', cwd: null }] },
        projects: { p1: [] },
        currentProjectId: 'p1',
        revs: { p1: 3 },
      },
      files: {},
      scrollbacks: { 'term-1': 'out\n' },
    }
    let sentBody: string | null = null
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces/push`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('POST')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      sentBody = String(init?.body)
      return jsonResponse({ ok: true, bytes: sentBody?.length ?? 0 }, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const result = await client.pushSpaceContent(payload)
    expect(sentCookie).toBe('ts_session=x')
    expect(JSON.parse(sentBody ?? '{}')).toEqual(payload)
    expect(result).toEqual({ ok: true, bytes: (sentBody ?? '').length })
  })

  it('pushSpaceContent() surfaces 403 upgrade_required as a CloudError', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'upgrade_required', message: 'Upgrade to Pro' } }, 403)
    )
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(
      client.pushSpaceContent({ workspace: {}, files: {}, scrollbacks: {} })
    ).rejects.toMatchObject({ status: 403, code: 'upgrade_required' })
  })
})

describe('CloudClient workspace bundles (whole-workspace sync)', () => {
  // A REAL bundle from buildBundle: two projects (one terminal, one not) so
  // the push assertions can prove ALL projects + revs ship, not just one.
  const bundle = buildBundle({
    index: {
      version: 1,
      projects: [
        { id: 'p1', name: 'main', cwd: null, closed: false },
        { id: 'p2', name: 'side', cwd: null, closed: false },
      ],
    },
    nodesFor: (id) =>
      id === 'p1'
        ? [{ id: 'term-1', type: 'terminal', position: { x: 0, y: 0 }, data: {} }]
        : [{ id: 'n-2', type: 'sticky', position: { x: 1, y: 1 }, data: {} }],
    revFor: (id) => (id === 'p1' ? 3 : 1),
    scrollbacksFor: (ids) => Object.fromEntries(ids.map((id) => [id, `${id} out\n`])),
    currentProjectId: 'p1',
  })

  it('pushWorkspaceContent() POSTs the full bundle — header, EVERY project, revs — to /spaces/push', async () => {
    let sentBody: string | null = null
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces/push`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('POST')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      sentBody = String(init?.body)
      return jsonResponse({ ok: true, bytes: sentBody?.length ?? 0 }, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const result = await client.pushWorkspaceContent(bundle)
    expect(sentCookie).toBe('ts_session=x')
    // The exact bundle goes out verbatim — header, all projects, revs.
    expect(JSON.parse(sentBody ?? '{}')).toEqual(bundle)
    const body = JSON.parse(sentBody ?? '{}') as WorkspaceBundle
    expect(body.bundle.format).toBe('termsprawl-workspace')
    expect(body.bundle.version).toBe(1)
    expect(typeof body.bundle.savedAt).toBe('string')
    expect(Object.keys(body.workspace.projects).sort()).toEqual(['p1', 'p2'])
    expect(body.workspace.revs).toEqual({ p1: 3, p2: 1 })
    expect(body.scrollbacks).toEqual({ 'term-1': 'term-1 out\n' })
    expect(result).toEqual({ ok: true, bytes: (sentBody ?? '').length })
  })

  it('pushWorkspaceContent() surfaces 403 upgrade_required as a CloudError', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'upgrade_required', message: 'Upgrade to Pro' } }, 403)
    )
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(client.pushWorkspaceContent(bundle)).rejects.toMatchObject({
      status: 403,
      code: 'upgrade_required',
    })
  })

  it('pullWorkspaceContent() GETs /spaces/pull with the session cookie and round-trips the bundle', async () => {
    let sentCookie: string | null = null
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/v1/spaces/pull`)
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
      sentCookie = (init?.headers as Record<string, string>)?.Cookie ?? null
      return jsonResponse(bundle, 200)
    })
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    const pulled = await client.pullWorkspaceContent()
    expect(sentCookie).toBe('ts_session=x')
    expect(pulled).toEqual(bundle)
    expect(pulled?.bundle.format).toBe('termsprawl-workspace')
    expect(pulled?.workspace.revs).toEqual({ p1: 3, p2: 1 })
  })

  it('pullWorkspaceContent() maps 404 no_content to null (nothing online yet)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'no_content', message: 'No snapshot yet' } }, 404)
    )
    const client = new CloudClient({ apiBase: ORIGIN, fetchFn, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(client.pullWorkspaceContent()).resolves.toBeNull()
  })

  it('pullWorkspaceContent() keeps other 404 codes as errors and surfaces 403 upgrade_required', async () => {
    const otherCode = vi.fn(async () =>
      jsonResponse({ error: { code: 'no_space', message: 'No space provisioned yet' } }, 404)
    )
    const otherClient = new CloudClient({ apiBase: ORIGIN, fetchFn: otherCode, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(otherClient.pullWorkspaceContent()).rejects.toMatchObject({ code: 'no_space' })

    const upgrade = vi.fn(async () =>
      jsonResponse({ error: { code: 'upgrade_required', message: 'Upgrade to Pro' } }, 403)
    )
    const proClient = new CloudClient({ apiBase: ORIGIN, fetchFn: upgrade, keepCookie: () => {}, getCookie: () => 'ts_session=x' })
    await expect(proClient.pullWorkspaceContent()).rejects.toMatchObject({ status: 403, code: 'upgrade_required' })
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
