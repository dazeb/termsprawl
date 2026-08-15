import { afterEach, describe, expect, it } from 'vitest'
import { HookServer } from './hook-server'
import type { AgentStatusEvent } from '../../core/agent-status'

// The hook server is a loopback HTTP endpoint agent CLIs POST to. It must be
// fail-open: unknown tokens/agents/payloads get a fast 200 and never crash.

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe('HookServer', () => {
  const servers: HookServer[] = []

  async function makeServer(): Promise<{ server: HookServer; events: AgentStatusEvent[] }> {
    const events: AgentStatusEvent[] = []
    const server = new HookServer((e) => events.push(e))
    await server.start()
    servers.push(server)
    return { server, events }
  }

  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  it('starts on loopback and exposes a base URL', async () => {
    const { server } = await makeServer()
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  })

  it('normalizes a Claude hook POST and emits a status event', async () => {
    const { server, events } = await makeServer()
    const res = await fetch(`${server.url}hook/claude`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        tool_name: 'Bash'
      })
    })
    expect(res.status).toBe(200)
    await waitFor(() => events.length > 0)
    expect(events[0].sessionId).toBe('sess-1')
    expect(events[0].status).toBe('working')
    expect(events[0].tool).toBe('Bash')
  })

  it('emits done for a Stop hook', async () => {
    const { server, events } = await makeServer()
    await fetch(`${server.url}hook/claude`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-2' })
    })
    await waitFor(() => events.length > 0)
    expect(events[0].status).toBe('done')
  })

  it('is fail-open: unknown payloads and agents return 200 without events', async () => {
    const { server, events } = await makeServer()
    const bad = await fetch(`${server.url}hook/unknown-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ something: 'else' })
    })
    expect(bad.status).toBe(200)
    await new Promise((r) => setTimeout(r, 100))
    expect(events).toEqual([])

    const malformed = await fetch(`${server.url}hook/claude`, {
      method: 'POST',
      body: 'not json {{{'
    })
    expect(malformed.status).toBe(200)
    await new Promise((r) => setTimeout(r, 100))
    expect(events).toEqual([])
  })

  it('rejects non-POST methods', async () => {
    const { server, events } = await makeServer()
    const res = await fetch(`${server.url}hook/claude`, { method: 'GET' })
    expect(res.status).toBe(405)
    expect(events).toEqual([])
  })
})
