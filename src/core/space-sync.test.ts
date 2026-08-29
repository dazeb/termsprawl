import { describe, expect, it, vi } from 'vitest'
import {
  createPushScheduler,
  pullLatest,
  pushSnapshot,
  SpaceSyncError,
  type SpaceSnapshotPayload,
} from './space-sync'

const ORIGIN = 'http://127.0.0.1:8787'
const PAYLOAD: SpaceSnapshotPayload = {
  workspace: { rev: 7 },
  files: { '.termsprawl/project.json': { nodes: [] } },
  scrollbacks: { 'term-1': 'session restored\n$ ls\n' },
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function cfgWith(fetchFn: typeof fetch, now?: () => number) {
  return { apiBase: ORIGIN, bootToken: 'boot-token-1', fetchFn, ...(now ? { now } : {}) }
}

describe('pushSnapshot', () => {
  it('POSTs the snapshot with bearer auth and reports the byte size', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ ok: true }, 200)
    })
    const result = await pushSnapshot(cfgWith(fetchFn), PAYLOAD)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ORIGIN}/api/v1/space/content`)
    expect((calls[0].init?.method ?? '').toUpperCase()).toBe('POST')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer boot-token-1')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(PAYLOAD)
    expect(result).toEqual({ ok: true, bytes: new TextEncoder().encode(JSON.stringify(PAYLOAD)).length })
  })

  it('treats 429 and 5xx as retryable failures without throwing', async () => {
    for (const status of [429, 500, 503]) {
      const fetchFn = vi.fn(async () => jsonResponse({ error: { code: 'busy', message: 'slow down' } }, status))
      const result = await pushSnapshot(cfgWith(fetchFn), PAYLOAD)
      expect(result).toEqual({ ok: false, retryable: true, error: 'slow down' })
    }
  })

  it('treats 4xx as non-retryable with the parsed error message', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: { code: 'unauthorized', message: 'bad token' } }, 401))
    const result = await pushSnapshot(cfgWith(fetchFn), PAYLOAD)
    expect(result).toEqual({ ok: false, retryable: false, error: 'bad token' })
  })

  it('survives a network rejection as a retryable failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const result = await pushSnapshot(cfgWith(fetchFn), PAYLOAD)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure result')
    expect(result.retryable).toBe(true)
  })
})

describe('pullLatest', () => {
  it('GETs with bearer auth and returns the payload on 200', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse(PAYLOAD, 200)
    })
    const payload = await pullLatest(cfgWith(fetchFn))
    expect(calls[0].url).toBe(`${ORIGIN}/api/v1/space/content`)
    expect((calls[0].init?.method ?? 'GET').toUpperCase()).toBe('GET')
    expect((calls[0].init?.headers as Record<string, string>)['Authorization']).toBe('Bearer boot-token-1')
    expect(payload).toEqual(PAYLOAD)
  })

  it('returns null on 404 (no snapshot yet)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: { code: 'not_found', message: 'none' } }, 404))
    await expect(pullLatest(cfgWith(fetchFn))).resolves.toBeNull()
  })

  it('throws SpaceSyncError on other failures', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: { code: 'server_error', message: 'boom' } }, 500))
    let thrown: unknown
    try {
      await pullLatest(cfgWith(fetchFn))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(SpaceSyncError)
    expect((thrown as SpaceSyncError).status).toBe(500)
  })
})

describe('createPushScheduler', () => {
  it('coalesces marks made while a push is in flight into one follow-up push', async () => {
    let resolveFirst: ((r: Response) => void) | null = null
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(jsonResponse({ ok: true }, 200))
    })
    const scheduler = createPushScheduler(cfgWith(fetchFn), { getPayload: () => PAYLOAD })

    scheduler.markDirty() // starts push #1 (in flight, unresolved)
    await Promise.resolve() // let the push start
    scheduler.markDirty() // arrives mid-push → exactly one follow-up
    scheduler.markDirty() // second mid-push mark → still only one follow-up
    resolveFirst!(jsonResponse({ ok: true }, 200))
    await scheduler.flush() // waits for in-flight + the coalesced follow-up

    expect(calls).toHaveLength(2)
    expect(JSON.parse(String(calls[1].init?.body))).toEqual(PAYLOAD)
  })

  it('flush() with nothing dirty pushes nothing (null)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }, 200))
    const scheduler = createPushScheduler(cfgWith(fetchFn), { getPayload: () => PAYLOAD })
    await expect(scheduler.flush()).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('markDirty alone schedules a push that flush() then awaits', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }, 200))
    const scheduler = createPushScheduler(cfgWith(fetchFn), { getPayload: () => PAYLOAD })
    scheduler.markDirty()
    const result = await scheduler.flush()
    expect(result).toEqual({ ok: true, bytes: new TextEncoder().encode(JSON.stringify(PAYLOAD)).length })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('auto pushes (markDirty) respect minIntervalMs; flush() is an explicit force', async () => {
    let clock = 1_000_000
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }, 200))
    const scheduler = createPushScheduler(cfgWith(fetchFn, () => clock), {
      getPayload: () => PAYLOAD,
      minIntervalMs: 30_000,
    })
    scheduler.markDirty()
    await scheduler.flush()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    clock += 5_000 // too soon after the first push
    scheduler.markDirty() // pump refuses — stays dirty, no push
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchFn).toHaveBeenCalledTimes(1)

    clock += 30_000 // past the interval
    scheduler.markDirty() // pump pushes now
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchFn).toHaveBeenCalledTimes(2)

    clock += 1_000 // inside the window again
    scheduler.markDirty()
    await scheduler.flush() // explicit force wins over the debounce
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })
})
