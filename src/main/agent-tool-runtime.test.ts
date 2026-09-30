import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { PtyManager } from '../core/pty-manager'
import type { WorkspaceStore } from '../core/workspace-store'
import type { NodeLink } from '../shared/types'
import type { CanvasToolReply, CanvasToolRequest } from '../shared/agent-tools'
import { AgentToolRuntime } from './agent-tool-runtime'

const fake = vi.hoisted(() => ({ listeners: new Map<string, Function>(), handlers: new Map<string, Function>(), windows: [] as unknown[], guest: { id: 27, isDestroyed: () => false, executeJavaScript: vi.fn(async () => ({ text: 'page' })) } }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => fake.windows },
  ipcMain: { on: (channel: string, fn: Function) => fake.listeners.set(channel, fn), handle: (channel: string, fn: Function) => fake.handlers.set(channel, fn), removeAllListeners: (channel: string) => fake.listeners.delete(channel), removeHandler: (channel: string) => fake.handlers.delete(channel) },
  webContents: { fromId: () => fake.guest }
}))
vi.mock('./browser/manager', () => ({ guestIdForNode: () => 27 }))
const roots: string[] = []
const runtimes: AgentToolRuntime[] = []
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); fake.windows = []; vi.useRealTimers() })

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tool desktop ')); roots.push(root)
  const nodes = [{ id: 'a', type: 'terminal', data: { command: 'codex' } }, { id: 'b', type: 'terminal', data: { command: 'grok' } }, { id: 'page', type: 'browser', data: { tabs: [{ id: 'tab' }], activeTabId: 'tab' } }]
  const links: NodeLink[] = []
  const pty = { hasReadySession: vi.fn(() => true), writeManaged: vi.fn() }
  const runtime = new AgentToolRuntime({ userDataPath: root, broadcast: vi.fn() }, { snapshot: () => ({ index: { projects: [{ id: 'p', cwd: root }] }, projects: { p: nodes } }), linksFor: () => links } as unknown as WorkspaceStore, pty as unknown as PtyManager, () => true)
  runtimes.push(runtime)
  // Runtime installation needs a source file only; tests don't execute this helper.
  await runtime.start(process.execPath, new URL('../core/agent-tools.ts', import.meta.url).pathname)
  const contents = { id: 1, mainFrame: {}, getURL: () => 'file:///index.html', send: (_channel: string, request: CanvasToolRequest) => {
    const result = request.operation === 'canvas_list' ? nodes : { nodeId: 'new' }
    fake.listeners.get(IPC.agentToolReply)?.({ sender: contents, senderFrame: contents.mainFrame }, { requestId: request.requestId, result: { ok: true, value: result } })
  } }
  fake.windows = [{ isDestroyed: () => false, webContents: contents }]
  const status = { state: 'cli-fallback' as const, adapter: 'grok-cli', version: 'test', reason: '' }
  const a = runtime.server.provision({ nodeId: 'a', projectId: 'p' }, status, false)
  const b = runtime.server.provision({ nodeId: 'b', projectId: 'p' }, status, false)
  return { runtime, a, b, contents, links, pty, root }
}

describe('desktop agent operations', () => {
  it('does not recover pending tasks before acquiring the backend directory lock', async () => {
    const { runtime, a, links, root } = await setup()
    links.push({ id: 'link', source: 'a', target: 'b', kind: 'context-inject', auto: false,
      config: { kind: 'context-inject', wrapper: true, pastePointer: false, agentMessages: true }, createdAt: 1 })
    const task = await runtime.server.invoke(a, { operation: 'agent_send', args: { nodeId: 'b', text: 'Still running', messageId: 'lock-test' } }) as { id: string }
    const second = new AgentToolRuntime({ userDataPath: root, broadcast: vi.fn() }, {} as WorkspaceStore, {} as PtyManager, () => false)
    runtimes.push(second)
    await expect(second.start(process.execPath, new URL('../core/agent-tools.ts', import.meta.url).pathname)).rejects.toThrow('already using')
    expect(JSON.parse(readFileSync(join(runtime.server.directory, 'tasks', `${task.id}.json`), 'utf8')).state).toBe('submitted')
  })

  it('submits a linked peer request and returns its correlated reply through tools', async () => {
    const { runtime, a, b, links, pty } = await setup()
    links.push({ id: 'link', source: 'a', target: 'b', kind: 'context-inject', auto: false,
      config: { kind: 'context-inject', wrapper: true, pastePointer: true, agentMessages: true }, createdAt: 1 })
    const cards = await runtime.server.invoke(a, { operation: 'agent_cards', args: {} }) as Array<{ nodeId: string; enabledPeerIds: string[] }>
    expect(cards.find((c) => c.nodeId === 'a')?.enabledPeerIds).toEqual(['b'])
    const task = await runtime.server.invoke(a, { operation: 'agent_send', args: { nodeId: 'b', text: 'Review the parser', messageId: 'review-1' } }) as { id: string; state: string }
    expect(task.state).toBe('submitted')
    expect(pty.writeManaged).toHaveBeenCalledWith('b', expect.stringContaining('Review the parser'), true)
    await runtime.server.invoke(b, { operation: 'agent_reply', args: { taskId: task.id, text: 'Parser review complete' } })
    await expect(runtime.server.invoke(a, { operation: 'agent_task', args: { taskId: task.id } })).resolves.toMatchObject({ state: 'completed', response: 'Parser review complete' })
    expect(pty.writeManaged).toHaveBeenCalledTimes(1)
  })

  it('uses the same backend for per-node A2A discovery, automatic submission and result polling', async () => {
    const { runtime, a, b, links, pty } = await setup()
    links.push({ id: 'link', source: 'a', target: 'b', kind: 'context-inject', auto: false,
      config: { kind: 'context-inject', wrapper: true, pastePointer: false, agentMessages: true }, createdAt: 1 })
    const endpoint = JSON.parse(readFileSync(join(runtime.server.directory, 'endpoint.json'), 'utf8')).url.replace(/\/call$/, '')
    const headers = { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }
    const card = await fetch(`${endpoint}/a2a/agents/b/.well-known/agent-card.json`, { headers })
    expect(card.status).toBe(200)
    expect(await card.json()).toMatchObject({ protocolVersion: '0.3.0', url: `${endpoint}/a2a/agents/b`, security: [{ bearer: [] }] })
    const rpc = async (method: string, params: unknown) => (await fetch(`${endpoint}/a2a/agents/b`, { method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 'rpc1', method, params }) })).json()
    const sent = await rpc('message/send', { message: { kind: 'message', role: 'user', messageId: 'http-review', parts: [{ kind: 'text', text: 'Review via A2A' }] } })
    expect(sent.result).toMatchObject({ kind: 'task', status: { state: 'submitted' } })
    await runtime.server.invoke(b, { operation: 'agent_reply', args: { taskId: sent.result.id, text: 'HTTP review complete' } })
    const result = await rpc('tasks/get', { id: sent.result.id })
    expect(result.result.status.state).toBe('completed')
    expect(result.result.artifacts[0].parts).toEqual([{ kind: 'text', text: 'HTTP review complete' }])
    const denied = await fetch(`${endpoint}/a2a/agents/b/.well-known/agent-card.json`)
    expect(denied.status).toBe(401)
    expect((await fetch(`${endpoint}/a2a/agents/foreign/.well-known/agent-card.json`, { headers })).status).toBe(404)
    expect((await fetch(`${endpoint}/a2a/agents/b/.well-known/agent-card.json`, { headers: { ...headers, origin: 'https://example.com' } })).status).toBe(403)
    expect((await rpc('message/send', { message: { kind: 'message', role: 'user', messageId: 'bad-message', parts: [{ kind: 'file', text: 'no' }] } })).error.code).toBe(-32602)
    expect((await rpc('tasks/cancel', { id: sent.result.id })).error.code).toBe(-32601)
    const wrongEndpoint = await fetch(`${endpoint}/a2a/agents/a`, { method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 'wrong-target', method: 'tasks/get', params: { id: sent.result.id } }) })
    expect((await wrongEndpoint.json()).error.code).toBe(-32001)
    expect(pty.writeManaged).toHaveBeenCalledTimes(1)
  })

  it('coordinates browser ownership across agents and allows an explicit transfer', async () => {
    const { runtime, a, b } = await setup()
    await runtime.server.invoke(a, { operation: 'browser_claim', args: { nodeId: 'page' } })
    await expect(runtime.server.invoke(b, { operation: 'browser_inspect', args: { nodeId: 'page' } })).rejects.toThrow('owner')
    await runtime.server.invoke(a, { operation: 'browser_transfer', args: { nodeId: 'page', agentNodeId: 'b' } })
    await expect(runtime.server.invoke(b, { operation: 'browser_inspect', args: { nodeId: 'page' } })).resolves.toEqual({ text: 'page' })
    runtime.revoke('b')
    await expect(runtime.server.invoke(a, { operation: 'browser_claim', args: { nodeId: 'page' } })).resolves.toMatchObject({ owner: 'a' })
  })

  it('checks target project membership and avoids sending commands to the requesting agent', async () => {
    const { runtime, a } = await setup()
    await expect(runtime.server.invoke(a, { operation: 'browser_claim', args: { nodeId: 'foreign' } })).rejects.toThrow('not found')
    await expect(runtime.server.invoke(a, { operation: 'terminal_submit', args: { nodeId: 'a', command: 'echo unsafe' } })).rejects.toThrow('own agent')
  })

  it('rejects renderer errors and ignores acknowledgements from the wrong sender', async () => {
    const { runtime, a, contents } = await setup()
    const send = contents.send
    contents.send = (channel, request) => {
      if (request.operation === 'canvas_list') { send(channel, request); return }
      const reply: CanvasToolReply = { requestId: request.requestId, result: { ok: true, value: 'forged' } }
      fake.listeners.get(IPC.agentToolReply)?.({ sender: { id: 999 }, senderFrame: null }, reply)
      fake.listeners.get(IPC.agentToolReply)?.({ sender: contents, senderFrame: contents.mainFrame }, { ...reply, result: { ok: false, error: 'Project is not visible' } })
    }
    await expect(runtime.server.invoke(a, { operation: 'sticky_open', args: { text: 'note' } })).rejects.toThrow('not visible')
  })

  it('times out missing acknowledgements without retrying a mutation', async () => {
    const { runtime, a, contents } = await setup()
    vi.useFakeTimers()
    contents.send = vi.fn()
    const pending = runtime.server.invoke(a, { operation: 'sticky_open', args: { text: 'note' } })
    const assertion = expect(pending).rejects.toThrow('did not acknowledge')
    await vi.advanceTimersByTimeAsync(10_001)
    await assertion
    expect(contents.send).toHaveBeenCalledTimes(1)
  })
})
