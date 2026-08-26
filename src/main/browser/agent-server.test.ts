import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startAgentServer,
  AGENT_OPEN_CHANNEL,
  type AgentServerHandle
} from './agent-server'

describe('agent-server', () => {
  let handle: AgentServerHandle
  let userDataPath: string
  const broadcasts: Array<{ channel: string; payload: unknown }> = []

  beforeAll(async () => {
    userDataPath = mkdtempSync(join(tmpdir(), 'termsprawl-agent-'))
    handle = await startAgentServer({
      userDataPath,
      broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
      cdp: { wsUrl: 'http://127.0.0.1:9231', host: '127.0.0.1', port: 9231 }
    })
  })

  afterAll(async () => {
    await handle.close()
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${handle.url}/info`)
    expect(res.status).toBe(401)
  })

  it('serves endpoint info to an authenticated caller', async () => {
    const res = await fetch(`${handle.url}/info`, {
      headers: { authorization: `Bearer ${handle.token}` }
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; cdp: { port: number } }
    expect(j.ok).toBe(true)
    expect(j.cdp.port).toBe(9231)
  })

  it('open broadcasts the valid url and returns ok', async () => {
    const res = await fetch(`${handle.url}/open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; url: string }
    expect(j.ok).toBe(true)
    expect(j.url).toBe('https://example.com')
    expect(broadcasts.at(-1)).toEqual({
      channel: AGENT_OPEN_CHANNEL,
      payload: { url: 'https://example.com' }
    })
  })

  it('denies a blocked url before broadcasting', async () => {
    const before = broadcasts.length
    const res = await fetch(`${handle.url}/open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd' })
    })
    expect(res.status).toBe(400)
    expect(broadcasts.length).toBe(before)
  })

  it('opens about:blank when no url is given', async () => {
    const res = await fetch(`${handle.url}/open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}` }
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; url: string }
    expect(j.url).toBe('about:blank')
  })

  it('denies authentication for a wrong token', async () => {
    const res = await fetch(`${handle.url}/open`, {
      method: 'POST',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
      body: '{}'
    })
    expect(res.status).toBe(401)
  })

  it('writes a discovery file with port, token, and cdp', () => {
    const j = JSON.parse(readFileSync(handle.endpointFile, 'utf8'))
    expect(j.port).toBe(handle.port)
    expect(j.token).toBe(handle.token)
    expect(j.cdp.port).toBe(9231)
    expect(j.open.path).toBe('/open')
  })

  it('removes the discovery file on close (a stopped endpoint is never advertised)', async () => {
    const h = await startAgentServer({
      userDataPath,
      broadcast: () => {},
      cdp: { wsUrl: 'http://127.0.0.1:9231', host: '127.0.0.1', port: 9231 }
    })
    expect(existsSync(h.endpointFile)).toBe(true)
    await h.close()
    expect(existsSync(h.endpointFile)).toBe(false)
  })
})
