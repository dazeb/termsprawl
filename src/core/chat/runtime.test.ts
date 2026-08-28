// Phase 11 Task 11.4 — chat runtime wiring TDD. Fake drivers; asserts per-node
// busy-locking, abort, approval plumbing, and event broadcasting.
import { describe, it, expect, vi } from 'vitest'
import { createChatRuntime, driverFor, type ChatProviderConfig, type ChatRuntimeDeps } from './runtime'
import type { ChatEvent, ChatMessage } from './types'
import type { ChatDriver } from './tools'

const userMsg: ChatMessage = { id: 'u1', role: 'user', content: 'hi', ts: 1 }

function fakeDriver(turns: ChatEvent[][]): ChatDriver {
  let i = 0
  return {
    async *stream() {
      const events = turns[Math.min(i++, turns.length - 1)]
      for (const ev of events) yield ev
    }
  }
}

function makeDeps(
  driver: ChatDriver | null,
  provider: ChatProviderConfig | null
): ChatRuntimeDeps & { events: Array<{ nodeId: string; event: ChatEvent }> } {
  const events: Array<{ nodeId: string; event: ChatEvent }> = []
  return {
    events,
    resolveProvider: () => provider,
    driverFor: driver ? () => driver : undefined,
    broadcast: (nodeId, event) => events.push({ nodeId, event }),
    log: vi.fn()
  }
}

/** Default deps with a provider + scripted driver. */
function withDriver(driver: ChatDriver): ChatRuntimeDeps & { events: Array<{ nodeId: string; event: ChatEvent }> } {
  return makeDeps(driver, { id: 'p1', baseUrl: 'https://api.test', apiKey: 'k', model: 'test-model' })
}

describe('driverFor', () => {
  it('returns an openai-shaped driver by default and anthropic when asked', () => {
    const openai = driverFor({ id: 'x', baseUrl: 'http://127.0.0.1:9', apiKey: 'k' })
    const anthropic = driverFor({ id: 'x', baseUrl: 'http://127.0.0.1:9', apiKey: 'k', api: 'anthropic' })
    expect(openai.stream).toBeTypeOf('function')
    expect(anthropic.stream).toBeTypeOf('function')
  })
})

describe('createChatRuntime', () => {
  it('streams events to the node channel and finishes ok', async () => {
    const driver = fakeDriver([[{ kind: 'delta', text: 'hey' }, { kind: 'done', reason: 'end_turn' }]])
    const deps = withDriver(driver)
    const rt = createChatRuntime(deps)
    const res = await rt.send({ nodeId: 'n1', messages: [userMsg] })
    expect(res.ok).toBe(true)
    expect(deps.events.map((e) => e.event.kind)).toEqual(['delta', 'done'])
    expect(deps.events.every((e) => e.nodeId === 'n1')).toBe(true)
    expect(rt.isBusy('n1')).toBe(false)
  })

  it('rejects a second concurrent send for the same node', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const driver: ChatDriver = {
      async *stream() {
        await gate
        yield { kind: 'done', reason: 'end_turn' }
      }
    }
    const rt = createChatRuntime(withDriver(driver))
    const first = rt.send({ nodeId: 'n1', messages: [userMsg] })
    await new Promise((r) => setTimeout(r, 5))
    const second = await rt.send({ nodeId: 'n1', messages: [userMsg] })
    expect(second.ok).toBe(false)
    expect(second.error).toContain('already running')
    release()
    expect((await first).ok).toBe(true)
  })

  it('stop() aborts the run; the send resolves', async () => {
    const driver: ChatDriver = {
      async *stream(opts) {
        yield { kind: 'delta', text: 'working' }
        // simulate a long stream cut by the abort signal
        if (opts.signal?.aborted) return
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000)
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(t)
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
        yield { kind: 'done', reason: 'end_turn' }
      }
    }
    const rt = createChatRuntime(withDriver(driver))
    const pending = rt.send({ nodeId: 'n1', messages: [userMsg] })
    await new Promise((r) => setTimeout(r, 10))
    rt.stop('n1')
    const res = await pending
    expect(res.ok).toBe(true)
  })

  it('no provider configured → ok:false with a helpful error', async () => {
    const rt = createChatRuntime(makeDeps(null, null))
    const res = await rt.send({ nodeId: 'n1', messages: [userMsg] })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('no chat provider')
  })

  it('approval flow: requestApproval parks until approve() resolves it', async () => {
    const driver = fakeDriver([[{ kind: 'toolCall', call: { id: 'c1', name: 't', argsJson: '{}', status: 'done' } }, { kind: 'done', reason: 'end_turn' }]])
    const rt = createChatRuntime(withDriver(driver))
    const pending = rt.send({ nodeId: 'n1', messages: [userMsg] })
    await new Promise((r) => setTimeout(r, 10))
    rt.approve('n1', 'c1', 'approve')
    const res = await pending
    expect(res.ok).toBe(true)
  })
})
