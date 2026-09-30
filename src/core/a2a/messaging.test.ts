import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentMessagingService, type AgentNodeInfo } from './messaging'
import type { NodeLink } from '../../shared/types'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ts-messaging-'))
  roots.push(directory)
  const source = { nodeId: 'codex', projectId: 'p' }
  const target = { nodeId: 'gemini', projectId: 'p' }
  let nodes: AgentNodeInfo[] = ['codex', 'gemini', 'other'].map(id => ({ id, title: id, command: id, agentId: id, status: { state: 'connected', adapter: id, version: '', reason: '' } }))
  let links = [{ id: 'link', source: 'codex', target: 'gemini', kind: 'context-inject', auto: false, config: { kind: 'context-inject', wrapper: true, pastePointer: false, agentMessages: true }, createdAt: 0 }] as NodeLink[]
  let now = 1000
  const delivered: string[] = []
  let failure = false
  const deps = { agents: (id: string) => id === 'p' ? nodes : [], links: () => links, now: () => now, deliver: async (_id: string, prompt: string) => { if (failure) throw Error('offline'); delivered.push(prompt) } }
  const service = new AgentMessagingService(directory, deps)
  return { service, directory, deps, source, target, delivered, setLinks: (v: NodeLink[]) => { links = v }, setNodes: (v: AgentNodeInfo[]) => { nodes = v }, fail: () => { failure = true }, advance: () => { now += 24 * 60 * 60 * 1000 } }
}

describe('local linked agent messaging', () => {
  it('does not follow symlinked task records or overwrite their target on recovery', async () => {
    const f = fixture()
    const t = await f.service.send(f.source, { nodeId: 'gemini', text: 'x' })
    const outside = join(f.directory, 'outside-record')
    const original = JSON.stringify(t)
    writeFileSync(outside, original)
    rmSync(join(f.directory, `${t.id}.json`))
    symlinkSync(outside, join(f.directory, `${t.id}.json`))
    const restarted = new AgentMessagingService(f.directory, f.deps)
    expect(() => restarted.task(f.source, t.id)).toThrow(/unavailable/i)
    expect(readFileSync(outside, 'utf8')).toBe(original)
  })

  it('Codex discovers Gemini, submits work automatically and polls its correlated reply', async () => {
    const f = fixture()
    expect(f.service.cards(f.source).find(c => c.nodeId === 'codex')?.enabledPeerIds).toEqual(['gemini'])
    const task = await f.service.send(f.source, { nodeId: 'gemini', text: 'Review $(touch nope)\nplease' })
    expect(task.state).toBe('submitted')
    expect(f.delivered).toHaveLength(1)
    expect(f.delivered[0]).toContain('agent_reply')
    expect(f.delivered[0]).toContain(task.id)
    expect(f.delivered[0]).toContain('peer data')
    expect(f.service.reply(f.target, { taskId: task.id, text: 'Looks good' }).state).toBe('completed')
    expect(f.service.task(f.source, task.id).response).toBe('Looks good')
    expect(f.delivered).toHaveLength(1)
    const file = readdirSync(f.directory).find(n => n.endsWith('.json'))!
    expect(statSync(join(f.directory, file)).mode & 0o777).toBe(0o600)
  })
  it('requires an enabled directed same-project link and active recipient', async () => {
    const f = fixture()
    await expect(f.service.send(f.target, { nodeId: 'codex', text: 'x' })).rejects.toThrow(/link/i)
    f.setLinks([])
    await expect(f.service.send(f.source, { nodeId: 'gemini', text: 'x' })).rejects.toThrow(/link/i)
    await expect(f.service.send(f.source, { nodeId: 'codex', text: 'x' })).rejects.toThrow(/self/i)
    await expect(f.service.send({ ...f.source, projectId: 'other' }, { nodeId: 'gemini', text: 'x' })).rejects.toThrow()
    f.setNodes([])
    await expect(f.service.send(f.source, { nodeId: 'gemini', text: 'x' })).rejects.toThrow()
  })
  it('rejects disabled links and unsupported inactive recipients', async () => {
    const f = fixture()
    f.setLinks([{ id: 'l', source: 'codex', target: 'gemini', kind: 'context-inject', auto: true, config: { kind: 'context-inject', wrapper: true, pastePointer: false }, createdAt: 0 }])
    await expect(f.service.send(f.source, { nodeId: 'gemini', text: 'x' })).rejects.toThrow(/link/i)
    f.setNodes([{ id: 'codex', title: 'Codex', command: 'codex', status: { state: 'connected', adapter: '', reason: '', version: '' } }, { id: 'gemini', title: 'Gemini', command: 'gemini' }])
    await expect(f.service.send(f.source, { nodeId: 'gemini', text: 'x' })).rejects.toThrow(/active/i)
  })
  it('rejects spoofed reads and replies and rechecks link authorization', async () => {
    const f = fixture(); const t = await f.service.send(f.source, { nodeId: 'gemini', text: 'x' })
    expect(() => f.service.task({ nodeId: 'other', projectId: 'p' }, t.id)).toThrow()
    expect(() => f.service.task({ ...f.source, projectId: 'other' }, t.id)).toThrow()
    expect(() => f.service.reply(f.source, { taskId: t.id, text: 'fake' })).toThrow()
    f.setLinks([])
    expect(() => f.service.reply(f.target, { taskId: t.id, text: 'reply' })).toThrow(/link/i)
  })
  it('scopes exact retries, rejects changed payloads and busy recipients', async () => {
    const f = fixture(); const args = { nodeId: 'gemini', text: 'x', messageId: 'retry' }
    const t = await f.service.send(f.source, args)
    expect((await f.service.send(f.source, args)).id).toBe(t.id)
    expect(f.delivered).toHaveLength(1)
    await expect(f.service.send(f.source, { ...args, text: 'changed' })).rejects.toThrow(/messageId/i)
    await expect(f.service.send(f.source, { nodeId: 'gemini', text: 'second' })).rejects.toThrow(/busy/i)
    const reply = { taskId: t.id, text: 'ok' }
    f.service.reply(f.target, reply)
    expect(f.service.reply(f.target, reply).response).toBe('ok')
    expect(() => f.service.reply(f.target, { ...reply, text: 'changed' })).toThrow()
  })
  it('fails delivery, expiration and revoked tasks without injecting replies', async () => {
    const f = fixture(); f.fail()
    const t = await f.service.send(f.source, { nodeId: 'gemini', text: 'x' })
    expect(t.state).toBe('failed')
    const g = fixture(); const pending = await g.service.send(g.source, { nodeId: 'gemini', text: 'x' }); g.advance()
    expect(g.service.task(g.source, pending.id).state).toBe('failed')
    const h = fixture(); const revoked = await h.service.send(h.source, { nodeId: 'gemini', text: 'x' }); h.service.revoke('gemini')
    expect(h.service.task(h.source, revoked.id).state).toBe('failed')
  })
  it('recovers terminal tasks but fails unresolved tasks on restart and ignores malformed files', async () => {
    const f = fixture(); const t = await f.service.send(f.source, { nodeId: 'gemini', text: 'x', messageId: 'r' })
    writeFileSync(join(f.directory, 'broken.json'), '{')
    const restarted = new AgentMessagingService(f.directory, f.deps)
    expect(restarted.task(f.source, t.id).state).toBe('failed')
    expect((await restarted.send(f.source, { nodeId: 'gemini', text: 'x', messageId: 'r' })).id).toBe(t.id)
    expect(f.delivered).toHaveLength(1)
    expect(readFileSync(join(f.directory, `${t.id}.json`), 'utf8')).toContain('failed')
  })
  it('rejects control characters, huge payloads and work after close', async () => {
    const f = fixture()
    for (const text of ['', '\u001b[31m', 'x'.repeat(16001), 'bad\rinput']) await expect(f.service.send(f.source, { nodeId: 'gemini', text })).rejects.toThrow()
    f.service.close()
    await expect(f.service.send(f.source, { nodeId: 'gemini', text: 'x' })).rejects.toThrow(/closed/i)
  })
})
