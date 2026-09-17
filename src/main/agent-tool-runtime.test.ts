import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { PtyManager } from '../core/pty-manager'
import type { WorkspaceStore } from '../core/workspace-store'
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
  const runtime = new AgentToolRuntime({ userDataPath: root, broadcast: vi.fn() }, { snapshot: () => ({ index: { projects: [{ id: 'p', cwd: root }] }, projects: { p: nodes } }) } as unknown as WorkspaceStore, {} as PtyManager, () => true)
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
  return { runtime, a, b, contents }
}

describe('desktop agent operations', () => {
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
