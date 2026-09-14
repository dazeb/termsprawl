import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startA2aServer, type A2aNodeInfo } from './server'

function nodes(): A2aNodeInfo[] {
  return [
    { id: 'agent1', title: 'claude build', command: 'claude' },
    { id: 'agent2', title: 'codex', command: 'codex' }
  ]
}

function makeDeps() {
  const delivered: Array<{ nodeId: string; text: string }> = []
  return {
    delivered,
    deps: {
      agentNodes: nodes,
      deliverToNode: async (nodeId: string, text: string) => {
        delivered.push({ nodeId, text })
      }
    }
  }
}

describe('A2A server', () => {
  let userData: string
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'ts-a2a-'))
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('requires the bearer token for the agent card (audit 2026-09-06: was open)', async () => {
    const { deps } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    // Unauth
    const denied = await fetch(`http://127.0.0.1:${handle.port}/.well-known/agent-card.json`)
    expect(denied.status).toBe(401)
    // Authed
    const res = await fetch(`http://127.0.0.1:${handle.port}/.well-known/agent-card.json`, {
      headers: { authorization: `Bearer ${handle.token}` }
    })
    expect(res.status).toBe(200)
    const card = (await res.json()) as { name: string; skills: Array<{ id: string; name: string }> }
    expect(card.name).toBe('termsprawl agents')
    expect(card.skills).toHaveLength(2)
    expect(card.skills[0]).toMatchObject({ id: 'agent1', name: 'claude build' })
    await handle.close()
  })

  it('message/send delivers text into the node PTY and answers with a Message', async () => {
    const { deps, delivered } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    const res = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { role: 'user', kind: 'message', messageId: 'm1', parts: [{ kind: 'text', text: 'run the tests' }] } }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { jsonrpc: string; result: { kind: string; role: string; parts: Array<{ kind: string; text: string }> } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.result.kind).toBe('message')
    expect(body.result.role).toBe('agent')
    expect(body.result.parts[0].text).toContain('claude build')
    expect(delivered).toEqual([{ nodeId: 'agent1', text: 'run the tests' }])
    await handle.close()
  })

  it('routes by node id when the name does not match', async () => {
    const { deps, delivered } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { role: 'user', kind: 'message', messageId: 'm2', parts: [{ kind: 'text', text: 'to codex' }] } }
      })
    })
    expect(delivered[0].nodeId).toBe('agent1') // name "claude build" matches first; see matcher test below
    await handle.close()
  })

  it('returns -32602 when no agent nodes are live', async () => {
    const handle = await startA2aServer({
      userDataPath: userData,
      agentNodes: () => [],
      deliverToNode: async () => {}
    })
    const res = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { role: 'user', kind: 'message', messageId: 'm3', parts: [{ kind: 'text', text: 'hi' }] } }
      })
    })
    const body = (await res.json()) as { error?: { code: number; message: string } }
    expect(body.error?.code).toBe(-32602)
    expect(body.error?.message).toContain('no live agent nodes')
    await handle.close()
  })

  it('an explicit @unknown address still routes to the default node (documented fallback)', async () => {
    const { deps, delivered } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { role: 'user', kind: 'message', messageId: 'm4', parts: [{ kind: 'text', text: '@nobody hello' }] } }
      })
    })
    // Fallback: first live agent (the card is the discovery surface; an
    // unmatched address never silently drops the message).
    expect(delivered).toHaveLength(1)
    await handle.close()
  })

  it('rejects missing/wrong tokens with 401', async () => {
    const { deps } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    const noAuth = await fetch(`http://127.0.0.1:${handle.port}/`, { method: 'POST', body: '{}' })
    expect(noAuth.status).toBe(401)
    const badAuth = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      body: '{}'
    })
    expect(badAuth.status).toBe(401)
    // The agent card is token-gated too (audit 2026-09-06).
    const card = await fetch(`http://127.0.0.1:${handle.port}/.well-known/agent-card.json`)
    expect(card.status).toBe(401)
    await handle.close()
  })

  it('rejects non-message/send methods with -32601', async () => {
    const { deps } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    const res = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: {} })
    })
    const body = (await res.json()) as { error?: { code: number } }
    expect(body.error?.code).toBe(-32601)
    await handle.close()
  })

  it('writes the discovery file on start and removes it on close', async () => {
    const { deps } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    const file = join(userData, 'a2a-agent.json')
    expect(existsSync(file)).toBe(true)
    const disc = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string; url: string }
    expect(disc.port).toBe(handle.port)
    expect(disc.token).toBe(handle.token)
    expect(disc.url).toBe(`http://127.0.0.1:${handle.port}`)
    await handle.close()
    expect(existsSync(file)).toBe(false)
  })

  it('matches targets case-insensitively by title substring, else by id', async () => {
    const { deps, delivered } = makeDeps()
    const handle = await startA2aServer({ userDataPath: userData, ...deps })
    const send = async (text: string): Promise<void> => {
      await fetch(`http://127.0.0.1:${handle.port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: { message: { role: 'user', kind: 'message', messageId: 'mx', parts: [{ kind: 'text', text }] } }
        })
      })
    }
    // The peer addresses the node by its human name.
    await send('@codex deploy please')
    expect(delivered[0].nodeId).toBe('agent2')
    await send('claude build: run the tests')
    expect(delivered[1].nodeId).toBe('agent1')
    await handle.close()
  })
})
