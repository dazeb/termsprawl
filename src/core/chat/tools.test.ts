// Phase 11 Task 11.4 — chat driver v2 core: tool loop with permission gate TDD.
// Scripted fake drivers (async generators), no network.
import { describe, it, expect, vi } from 'vitest'
import { runChatLoop, type ChatDriver, type ChatToolDef } from './tools'
import type { ChatEvent, ChatMessage } from './types'

/** A driver that yields a scripted event list per stream() call. */
function scriptedDriver(turns: ChatEvent[][]): { driver: ChatDriver; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = []
  let i = 0
  const driver: ChatDriver = {
    async *stream(opts) {
      calls.push(opts.messages.map((m) => ({ ...m })))
      const events = turns[Math.min(i, turns.length - 1)]
      i++
      for (const ev of events) yield ev
    }
  }
  return { driver, calls }
}

const textReply = (text: string): ChatEvent => ({ kind: 'delta', text })
const done: ChatEvent = { kind: 'done', reason: 'end_turn' }
const toolCall = (id: string, name: string, argsJson: string): ChatEvent => ({
  kind: 'toolCall',
  call: { id, name, argsJson, status: 'done' }
})

const startMessages: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'go', ts: 1 }]

let autoTool: ChatToolDef
function makeAutoTool(): ChatToolDef {
  autoTool = {
    name: 'get_weather',
    description: 'weather lookup',
    schema: { type: 'object' },
    needsApproval: false,
    run: vi.fn(async () => 'sunny, 22C')
  }
  return autoTool
}

describe('runChatLoop', () => {
  it('auto-runs a no-approval tool and feeds the result back (second turn sees the tool message)', async () => {
    makeAutoTool()
    const { driver, calls } = scriptedDriver([
      [toolCall('c1', 'get_weather', '{"city":"Paris"}')],
      [textReply('It is sunny'), done]
    ])
    const events: ChatEvent[] = []
    const res = await runChatLoop(driver, 'gpt-4o', startMessages, [autoTool], {
      onEvent: (e) => events.push(e),
      requestApproval: async () => 'approve'
    })
    expect(res.stopReason).toBe('end_turn')
    expect(autoTool.run).toHaveBeenCalledWith({ city: 'Paris' })
    const toolMsg = res.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toBe('sunny, 22C')
    expect(toolMsg?.toolCalls?.[0].result).toBe('sunny, 22C')
    // the second stream call received the tool result message
    expect(calls[1].some((m) => m.role === 'tool' && m.content === 'sunny, 22C')).toBe(true)
    // events were forwarded
    expect(events.some((e) => e.kind === 'delta' && e.text === 'It is sunny')).toBe(true)
  })

  it('deny stops with stopReason denied and never runs the tool', async () => {
    const run = vi.fn(async () => 'should not run')
    const { driver } = scriptedDriver([[toolCall('c1', 'risky', '{}')]])
    const res = await runChatLoop(driver, 'm', startMessages, [{ ...autoTool, name: 'risky', needsApproval: true, run }], {
      onEvent: () => {},
      requestApproval: async () => 'deny'
    })
    expect(res.stopReason).toBe('denied')
    expect(run).not.toHaveBeenCalled()
    const toolMsg = res.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toBe('denied by user')
  })

  it('approve runs the tool and the loop continues to end_turn', async () => {
    const run = vi.fn(async () => 'did the thing')
    const { driver, calls } = scriptedDriver([[toolCall('c1', 'write_file', '{"p":"a"}')], [textReply('done'), done]])
    const res = await runChatLoop(driver, 'm', startMessages, [{ ...autoTool, name: 'write_file', needsApproval: true, run }], {
      onEvent: () => {},
      requestApproval: async () => 'approve'
    })
    expect(res.stopReason).toBe('end_turn')
    expect(run).toHaveBeenCalledWith({ p: 'a' })
    expect(calls[1].some((m) => m.role === 'tool' && m.content === 'did the thing')).toBe(true)
  })

  it('honors maxIterations with an always-tooling driver', async () => {
    makeAutoTool()
    const { driver } = scriptedDriver([[toolCall('c1', 'get_weather', '{}')]])
    const res = await runChatLoop(driver, 'm', startMessages, [autoTool], {
      onEvent: () => {},
      requestApproval: async () => 'approve',
      maxIterations: 1
    })
    expect(res.stopReason).toBe('max_iterations')
    expect(res.messages[res.messages.length - 1].role).toBe('system')
  })

  it('an onEvent that throws never breaks the loop', async () => {
    const { driver } = scriptedDriver([[textReply('ok'), done]])
    const res = await runChatLoop(driver, 'm', startMessages, [], {
      onEvent: () => {
        throw new Error('consumer bug')
      },
      requestApproval: async () => 'approve'
    })
    expect(res.stopReason).toBe('end_turn')
    expect(res.messages.some((m) => m.role === 'assistant' && m.content === 'ok')).toBe(true)
  })

  it('marks unknown tools as an error result and continues', async () => {
    const { driver, calls } = scriptedDriver([[toolCall('c1', 'nope', '{}')], [textReply('fine'), done]])
    const res = await runChatLoop(driver, 'm', startMessages, [autoTool], {
      onEvent: () => {},
      requestApproval: async () => 'deny'
    })
    expect(res.stopReason).toBe('end_turn')
    const toolMsg = res.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toBe('unknown tool: nope')
    expect(calls[1].some((m) => m.role === 'tool')).toBe(true)
  })

  it('tool run() throwing becomes an error result, loop continues', async () => {
    const boom: ChatToolDef = { ...autoTool, run: async () => { throw new Error('disk on fire') } }
    const { driver } = scriptedDriver([[toolCall('c1', 'get_weather', '{}')], [textReply('noted'), done]])
    const res = await runChatLoop(driver, 'm', startMessages, [boom], {
      onEvent: () => {},
      requestApproval: async () => 'approve'
    })
    const toolMsg = res.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toContain('tool error: disk on fire')
    expect(toolMsg?.toolCalls?.[0].status).toBe('error')
    expect(res.stopReason).toBe('end_turn')
  })

  it('accumulates deltas into a single assistant message', async () => {
    const { driver } = scriptedDriver([[textReply('a'), textReply('b'), { kind: 'usage', inputTokens: 1, outputTokens: 2, model: 'gpt-4o' }, done]])
    const res = await runChatLoop(driver, 'gpt-4o', startMessages, [], {
      onEvent: () => {},
      requestApproval: async () => 'approve'
    })
    const assistants = res.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content).toBe('ab')
    expect(assistants[0].usage).toEqual({ inputTokens: 1, outputTokens: 2 })
    expect(assistants[0].model).toBe('gpt-4o')
  })

  it('a stopped done event ends the loop respecting the user stop', async () => {
    makeAutoTool()
    const { driver } = scriptedDriver([[toolCall('c1', 'get_weather', '{}'), { kind: 'done', reason: 'stopped' }]])
    const res = await runChatLoop(driver, 'm', startMessages, [autoTool], {
      onEvent: () => {},
      requestApproval: async () => 'approve'
    })
    expect(res.stopReason).toBe('end_turn')
    expect(autoTool.run).not.toHaveBeenCalled()
  })
})
