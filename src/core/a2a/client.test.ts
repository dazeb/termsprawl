import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverAgentCard, sendText, trimTrailingSlash } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('trimTrailingSlash', () => {
  it('strips trailing slashes', () => {
    expect(trimTrailingSlash('http://x:99/')).toBe('http://x:99')
    expect(trimTrailingSlash('http://x:99')).toBe('http://x:99')
  })
})

describe('discoverAgentCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the well-known card path and parses it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ name: 'peer agent', url: 'http://p:1/' })
    )
    const out = await discoverAgentCard('http://peer:9907', { fetch: fetchMock as unknown as typeof fetch })
    expect(out).toEqual({ ok: true, card: { name: 'peer agent', url: 'http://p:1/' } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://peer:9907/.well-known/agent-card.json')
    expect((init as RequestInit).method).toBe('GET')
  })

  it('sends a Bearer token when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: 'x' }))
    await discoverAgentCard('http://p', { fetch: fetchMock as unknown as typeof fetch, token: 'sekret' })
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sekret')
  })

  it('maps HTTP errors, bad JSON, and invalid cards to ok:false', async () => {
    const http404 = await discoverAgentCard('http://p', {
      fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 404 })) as unknown as typeof fetch
    })
    expect(http404).toEqual({ ok: false, error: 'HTTP 404' })

    const badJson = await discoverAgentCard('http://p', {
      fetch: vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })) as unknown as typeof fetch
    })
    expect(badJson).toEqual({ ok: false, error: 'invalid JSON from agent card' })

    const badCard = await discoverAgentCard('http://p', {
      fetch: vi.fn().mockResolvedValue(jsonResponse({ nope: true })) as unknown as typeof fetch
    })
    expect(badCard).toEqual({ ok: false, error: 'invalid agent card' })

    const network = await discoverAgentCard('http://p', {
      fetch: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    })
    expect(network.ok).toBe(false)
    if (!network.ok) expect(network.error).toContain('ECONNREFUSED')
  })
})

describe('sendText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs a message/send body and returns the agent text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'A2A-OK' }] }
      })
    )
    const out = await sendText('http://peer:9907', 'echo A2A-OK', { fetch: fetchMock as unknown as typeof fetch })
    expect(out).toEqual({ ok: true, text: 'A2A-OK' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://peer:9907/')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('message/send')
    expect(body.params.message.parts[0].text).toBe('echo A2A-OK')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
  })

  it('returns task summaries', async () => {
    const out = await sendText('http://p', 'go', {
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { kind: 'task', id: 't1', status: { state: 'submitted' } } })
      ) as unknown as typeof fetch
    })
    expect(out).toEqual({ ok: true, task: { id: 't1', state: 'submitted' } })
  })

  it('surfaces RPC errors from 200 bodies and HTTP errors', async () => {
    const rpcErr = await sendText('http://p', 'x', {
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'unknown node' } })
      ) as unknown as typeof fetch
    })
    expect(rpcErr).toEqual({ ok: false, error: 'RPC error -32602: unknown node' })

    const httpErr = await sendText('http://p', 'x', {
      fetch: vi.fn().mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch
    })
    expect(httpErr).toEqual({ ok: false, error: 'HTTP 500' })
  })

  it('refuses empty text without calling fetch', async () => {
    const fetchMock = vi.fn()
    const out = await sendText('http://p', '   ', { fetch: fetchMock as unknown as typeof fetch })
    expect(out).toEqual({ ok: false, error: 'empty message' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts on timeout', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })
    const out = await sendText('http://p', 'x', {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 50
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('A2A request failed')
  })
})
