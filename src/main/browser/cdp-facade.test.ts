// cdp-facade.test.ts — CDP facade protocol tests (electron + manager mocked).
//
// The facade is main-process code; electron is mocked so the HTTP/WS protocol
// can be exercised end-to-end in-process: /json/version discovery, target
// enumeration, attach + page-command proxying, and the Playwright/Puppeteer
// connect paths (auto-attach events, no-arg getTargetInfo, unsupported
// commands failing cleanly).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { startCdpFacade, type CdpFacadeHandle } from './cdp-facade'

interface FakeGuest {
  id: number
  title: string
  url: string
  isDestroyed(): boolean
  getTitle(): string
  getURL(): string
  debugger: {
    attached: boolean
    attach: ReturnType<typeof vi.fn>
    detach: ReturnType<typeof vi.fn>
    isAttached: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    sendCommand: ReturnType<typeof vi.fn>
  }
}

const mockGuests = new Map<number, FakeGuest>()
const mockRegisteredIds: number[] = []

vi.mock('electron', () => ({
  app: { getVersion: () => '0.6.0' },
  webContents: {
    fromId: (id: number) => mockGuests.get(id) ?? null
  }
}))

vi.mock('./manager', () => ({
  browserGuestIds: () => [...mockRegisteredIds]
}))

function fakeGuest(id: number, title = 'Example Domain', url = 'https://example.com/'): FakeGuest {
  const guest: FakeGuest = {
    id,
    title,
    url,
    isDestroyed: () => false,
    getTitle: () => guest.title,
    getURL: () => guest.url,
    debugger: {
      attached: false,
      attach: vi.fn(() => {
        guest.debugger.attached = true
      }),
      detach: vi.fn(() => {
        guest.debugger.attached = false
      }),
      isAttached: vi.fn(() => guest.debugger.attached),
      on: vi.fn(),
      sendCommand: vi.fn(async (method: string) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: `FRAME${id}` } } }
        }
        return {}
      })
    }
  }
  mockGuests.set(id, guest)
  return guest
}

/** Minimal CDP client over the facade's browser WS (token on the URL). */
class CdpClient {
  private ws: WebSocket
  private nextId = 0
  private pending = new Map<number, (m: unknown) => void>()
  events: { method: string; params: unknown }[] = []

  constructor(url: string) {
    // The facade requires the token as ?token= on the ws URL (audit
    // 2026-09-06). Append it unless the URL already carries one.
    const sep = url.includes('?') ? '&' : '?'
    this.ws = new WebSocket(`${url}${sep}token=${TEST_TOKEN}`)
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
    })
    this.ws.on('message', (data) => {
      const msg = JSON.parse(String(data))
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id)?.(msg)
        this.pending.delete(msg.id)
      } else if (msg.method !== undefined) {
        this.events.push({ method: msg.method, params: msg.params })
      }
    })
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
      )
    })
  }

  close(): void {
    this.ws.close()
  }
}

const TEST_TOKEN = 'facade-test-token-0123456789abcdef'
const CdpInfo = { wsUrl: '', host: '127.0.0.1', port: 0 }

describe('cdp-facade HTTP surface', () => {
  let handle: CdpFacadeHandle

  beforeEach(async () => {
    mockGuests.clear()
    mockRegisteredIds.length = 0
    handle = await startCdpFacade({ token: TEST_TOKEN, cdpInfo: CdpInfo })
  })

  afterEach(async () => {
    await handle.close()
  })

  it('rejects discovery without the token (audit 2026-09-06)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/json/version`)
    expect(res.status).toBe(401)
  })

  it('rejects an unauthenticated WebSocket upgrade (audit 2026-09-06)', async () => {
    // Authenticated discovery first to learn the real browserId path...
    const version = (await (
      await fetch(`http://127.0.0.1:${handle.port}/json/version?token=${TEST_TOKEN}`)
    ).json()) as { webSocketDebuggerUrl: string }
    const wsPath = new URL(version.webSocketDebuggerUrl).pathname
    // ...then connect to the SAME path WITHOUT the token. The facade must
    // close it before any CDP message is processed.
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}${wsPath}`)
    const result = await new Promise<'open' | 'close' | 'error'>((resolve) => {
      const t = setTimeout(() => resolve('close'), 2000)
      ws.on('open', () => {
        clearTimeout(t)
        // The facade closes it immediately; resolve on close/error.
        setTimeout(() => resolve('open'), 300)
      })
      ws.on('close', () => {
        clearTimeout(t)
        resolve('close')
      })
      ws.on('error', () => {
        clearTimeout(t)
        resolve('error')
      })
    })
    ws.close()
    expect(result).toBe('close')
  })

  it('serves /json/version with and without a trailing slash once authenticated (Playwright uses /json/version/)', async () => {
    for (const path of ['/json/version', '/json/version/']) {
      const res = await fetch(`http://127.0.0.1:${handle.port}${path}?token=${TEST_TOKEN}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        Browser: string
        webSocketDebuggerUrl: string
        cdp: { port: number }
      }
      expect(body.Browser).toContain('Electron')
      expect(body.webSocketDebuggerUrl).toContain(`127.0.0.1:${handle.port}`)
      // The ws URL must carry the token so the upgrade authenticates.
      expect(body.webSocketDebuggerUrl).toContain(`token=${TEST_TOKEN}`)
    }
  })

  it('404s unknown paths', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/json/list`)
    expect(res.status).toBe(404)
  })
})

describe('cdp-facade CDP protocol', () => {
  let handle: CdpFacadeHandle
  let client: CdpClient

  beforeEach(async () => {
    mockGuests.clear()
    mockRegisteredIds.length = 0
    handle = await startCdpFacade({ token: TEST_TOKEN, cdpInfo: CdpInfo })
    const version = (await (
      await fetch(`http://127.0.0.1:${handle.port}/json/version?token=${TEST_TOKEN}`)
    ).json()) as { webSocketDebuggerUrl: string }
    client = new CdpClient(version.webSocketDebuggerUrl)
    await client.open()
  })

  afterEach(async () => {
    client.close()
    await handle.close()
  })

  it('enumerates no targets when no browser nodes exist', async () => {
    const res = (await client.send('Target.getTargets')) as {
      result?: { targetInfos?: unknown[] }
    }
    expect(res.result?.targetInfos).toEqual([])
  })

  it('surfaces each live guest as a `page` target with its real target id', async () => {
    mockRegisteredIds.push(7)
    fakeGuest(7, 'Example Domain', 'https://example.com/')
    // Playwright's connect order: auto-attach first (learns the real target
    // id), then enumerate.
    await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
    await new Promise((r) => setTimeout(r, 20))

    const res = (await client.send('Target.getTargets')) as {
      result?: { targetInfos?: { targetId: string; type: string; browserContextId: string | null }[] }
    }
    expect(res.result?.targetInfos).toHaveLength(1)
    const info = res.result!.targetInfos![0]
    expect(info.type).toBe('page')
    // The target id must be the guest's REAL frame id (what Page.getFrameTree
    // reports), not the numeric webContents id — Playwright resolves frame
    // sessions by it and degrades to a dummy frame on mismatch.
    expect(info.targetId).toBe('FRAME7')
    expect(info.browserContextId).toBeTruthy()
  })

  it('answers a no-arg Target.getTargetInfo with the first live guest (Playwright connect path)', async () => {
    mockRegisteredIds.push(7)
    fakeGuest(7)
    await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
    await new Promise((r) => setTimeout(r, 20))

    const res = (await client.send('Target.getTargetInfo')) as {
      result?: { targetInfo?: { targetId: string; type: string } }
    }
    expect(res.result?.targetInfo?.targetId).toBe('FRAME7')
    expect(res.result?.targetInfo?.type).toBe('page')
  })

  it('answers Target.getTargetInfo for a known targetId and rejects unknown ones', async () => {
    mockRegisteredIds.push(7)
    fakeGuest(7)
    await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
    await new Promise((r) => setTimeout(r, 20))

    const known = (await client.send('Target.getTargetInfo', { targetId: 'FRAME7' })) as {
      result?: { targetInfo?: { targetId: string } }
    }
    expect(known.result?.targetInfo?.targetId).toBe('FRAME7')

    const unknown = (await client.send('Target.getTargetInfo', { targetId: 'NOPE' })) as {
      error?: { code: number }
    }
    expect(unknown.error?.code).toBe(-32000)
  })

  it('attaches a session and proxies page commands to the guest debugger', async () => {
    mockRegisteredIds.push(7)
    const guest = fakeGuest(7)

    // Puppeteer's connect order: enumerate (numeric fallback id), attach by it.
    const att = (await client.send('Target.attachToTarget', { targetId: '7', flatten: true })) as {
      result?: { sessionId: string }
    }
    const sid = att.result?.sessionId
    expect(sid).toBeTruthy()

    // The same guest attached again (now by its real id) returns the same session.
    const att2 = (await client.send('Target.attachToTarget', { targetId: 'FRAME7', flatten: true })) as {
      result?: { sessionId: string }
    }
    expect(att2.result?.sessionId).toBe(sid)

    const evalRes = (await client.send(
      'Runtime.evaluate',
      { expression: 'document.title' },
      sid
    )) as { sessionId?: string; result?: unknown }
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Runtime.evaluate', { expression: 'document.title' })
    expect(evalRes.sessionId).toBe(sid)
    expect(evalRes.result).toEqual({})
  })

  it('answers Playwright page-init commands locally instead of proxying them', async () => {
    mockRegisteredIds.push(7)
    const guest = fakeGuest(7)

    const att = (await client.send('Target.attachToTarget', { targetId: '7', flatten: true })) as {
      result?: { sessionId: string }
    }
    const sid = att.result!.sessionId!

    const rr = (await client.send('Runtime.runIfWaitingForDebugger', {}, sid)) as { result?: unknown }
    expect(rr.result).toEqual({})
    expect(guest.debugger.sendCommand).not.toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', expect.anything())

    const aa = (await client.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
      sid
    )) as { result?: unknown }
    expect(aa.result).toEqual({})
  })

  it('rejects attach to an unknown target', async () => {
    const res = (await client.send('Target.attachToTarget', { targetId: 'NOPE' })) as {
      error?: { code: number }
    }
    expect(res.error?.code).toBe(-32000)
  })

  it('rejects Target.createTarget with a pointer to opening a browser node', async () => {
    const res = (await client.send('Target.createTarget', { url: 'https://example.com' })) as {
      error?: { code: number; message: string }
    }
    expect(res.error?.code).toBe(-32601)
    expect(res.error?.message).toContain('open a browser node')
  })

  it('emits Target.attachedToTarget for live guests when auto-attach is enabled (Playwright connect model)', async () => {
    mockRegisteredIds.push(7)
    fakeGuest(7)

    const res = (await client.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })) as { result?: unknown }
    expect(res.result).toEqual({})

    await new Promise((r) => setTimeout(r, 50))
    const attachEvents = client.events.filter((e) => e.method === 'Target.attachedToTarget')
    expect(attachEvents).toHaveLength(1)
    const params = attachEvents[0].params as {
      sessionId: string
      targetInfo: { targetId: string; type: string }
    }
    expect(params.sessionId).toBeTruthy()
    expect(params.targetInfo.targetId).toBe('FRAME7')
    expect(params.targetInfo.type).toBe('page')

    // The advertised session must actually proxy a command.
    const evalRes = (await client.send(
      'Runtime.evaluate',
      { expression: '1 + 1' },
      params.sessionId
    )) as { sessionId?: string }
    expect(evalRes.sessionId).toBe(params.sessionId)
  })

  it('tolerates browser-level commands Playwright sends at connect', async () => {
    const results = await Promise.all([
      client.send('Browser.getVersion'),
      client.send('Browser.setDownloadBehavior', { behavior: 'deny' }),
      client.send('Target.setDiscoverTargets', { discover: true }),
      client.send('Target.setAutoAttachIgnoreOrigin', { ignore: true }),
      client.send('Target.closeTarget', { targetId: 'x' }),
      client.send('Browser.getWindowForTarget', { targetId: 'x' }),
      client.send('Target.getBrowserContexts')
    ])
    for (const r of results) {
      expect((r as { error?: unknown }).error).toBeUndefined()
    }
  })
})

describe('cdp-facade restart (settings toggle off→on)', () => {
  it('re-attaches the same guest after close() releases its debugger', async () => {
    mockGuests.clear()
    mockRegisteredIds.length = 0
    mockRegisteredIds.push(7)
    const guest = fakeGuest(7)

    // First instance: attach the guest, then close (as a toggle-off would).
    const first = await startCdpFacade({ token: TEST_TOKEN, cdpInfo: CdpInfo })
    const v1 = (await (
      await fetch(`http://127.0.0.1:${first.port}/json/version?token=${TEST_TOKEN}`)
    ).json()) as { webSocketDebuggerUrl: string }
    const c1 = new CdpClient(v1.webSocketDebuggerUrl)
    await c1.open()
    const att1 = (await c1.send('Target.attachToTarget', { targetId: '7', flatten: true })) as {
      result?: { sessionId: string }
    }
    expect(att1.result?.sessionId).toBeTruthy()
    c1.close()
    await first.close()
    // The debugger must be detached on close, so a second instance can attach.
    expect(guest.debugger.attached).toBe(false)

    // Second instance: attach the SAME guest again — must succeed.
    const second = await startCdpFacade({ token: TEST_TOKEN, cdpInfo: CdpInfo })
    const v2 = (await (
      await fetch(`http://127.0.0.1:${second.port}/json/version?token=${TEST_TOKEN}`)
    ).json()) as { webSocketDebuggerUrl: string }
    const c2 = new CdpClient(v2.webSocketDebuggerUrl)
    await c2.open()
    // Second instance: attach the SAME guest again (pre-attach → numeric
    // fallback id, like Puppeteer's enumerate-then-attach) — must succeed.
    const att2 = (await c2.send('Target.attachToTarget', { targetId: '7', flatten: true })) as {
      result?: { sessionId: string }
    }
    expect(att2.result?.sessionId).toBeTruthy()
    // And the session actually proxies a command.
    const evalRes = (await c2.send('Runtime.evaluate', { expression: '1 + 1' }, att2.result!.sessionId!)) as {
      result?: unknown
    }
    expect(evalRes.result).toEqual({})
    c2.close()
    await second.close()
  })
})
