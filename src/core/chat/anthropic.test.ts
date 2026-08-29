// Phase 11 Task 11.4 — chat driver v2 core: Anthropic adapter TDD. Fake fetch,
// canned SSE, no network.
import { describe, it, expect, vi } from 'vitest'
import { streamAnthropic, anthropicEndpoint, toAnthropicBody, type StreamAnthropicOptions } from './anthropic'
import { ChatError, type ChatEvent } from './types'

function sseBody(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text))
      c.close()
    }
  })
}

function fakeFetch(status: number, bodyText: string) {
  return vi.fn(async () => new Response(sseBody(bodyText), { status, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
}

const baseOpts = {
  apiKey: 'ak-test',
  model: 'claude-sonnet-4-5',
  messages: [{ id: 'u1', role: 'user' as const, content: 'hi', ts: 1 }]
}

async function collect(opts: Partial<StreamAnthropicOptions>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const ev of streamAnthropic({ ...baseOpts, ...opts })) events.push(ev)
  return events
}

describe('toAnthropicBody', () => {
  it('extracts a leading system message to top-level system', () => {
    const { system, messages } = toAnthropicBody([
      { id: 's1', role: 'system', content: 'be terse', ts: 0 },
      { id: 'u1', role: 'user', content: 'hi', ts: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', ts: 2 }
    ])
    expect(system).toBe('be terse')
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ])
  })
  it('prefers the explicit system option; tool results become user tool_result turns (audit B3)', () => {
    const { system, messages } = toAnthropicBody(
      [
        { id: 't1', role: 'tool', content: 'res', ts: 1 },
        { id: 'u1', role: 'user', content: 'q', ts: 2 }
      ],
      'explicit'
    )
    expect(system).toBe('explicit')
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'res' }] },
      { role: 'user', content: 'q' }
    ])
  })

  it('merges consecutive tool results into ONE user turn (alternation rule)', () => {
    const { messages } = toAnthropicBody([
      { id: 'a1', role: 'assistant', content: '', ts: 1, toolCalls: [
        { id: 'c1', name: 'read_file', argsJson: '{}', status: 'done' },
        { id: 'c2', name: 'list_dir', argsJson: '{}', status: 'done' }
      ] },
      { id: 't1', role: 'tool', content: 'res1', ts: 2, toolCalls: [{ id: 'c1', name: 'read_file', argsJson: '{}', status: 'done' }] },
      { id: 't2', role: 'tool', content: 'res2', ts: 3, toolCalls: [{ id: 'c2', name: 'list_dir', argsJson: '{}', status: 'done' }] }
    ])
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('assistant')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: 'res1' },
      { type: 'tool_result', tool_use_id: 'c2', content: 'res2' }
    ])
  })

  it('replays assistant toolCalls as tool_use blocks with text first (audit B3)', () => {
    const { messages } = toAnthropicBody([
      { id: 'a1', role: 'assistant', content: 'let me look', ts: 1, toolCalls: [
        { id: 'c1', name: 'read_file', argsJson: '{"path":"/p"}', status: 'done' }
      ] },
      { id: 't1', role: 'tool', content: 'file body', ts: 2, toolCalls: [{ id: 'c1', name: 'read_file', argsJson: '{}', status: 'done' }] }
    ])
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: '/p' } }
      ]
    })
  })

  it('drops note messages from the wire (audit B4)', () => {
    const { messages } = toAnthropicBody([
      { id: 'u1', role: 'user', content: 'q', ts: 1 },
      { id: 'n1', role: 'note', content: '1,234 tokens so far', ts: 2 },
      { id: 'a1', role: 'assistant', content: 'a', ts: 3 }
    ])
    expect(messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ])
  })
})

describe('streamAnthropic', () => {
  it('yields text deltas, usage from message_start+message_delta, then done', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"He"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"y"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      ''
    ].join('\n')
    const events = await collect({ fetchFn: fakeFetch(200, sse) })
    expect(events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text)).toEqual(['He', 'y'])
    expect(events).toContainEqual({ kind: 'usage', inputTokens: 12, outputTokens: 7, model: 'claude-sonnet-4-5' })
    expect(events[events.length - 1]).toEqual({ kind: 'done', reason: 'end_turn' })
  })

  it('maps thinking_delta to thinking events', async () => {
    const sse = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}',
      '',
      'data: {"type":"content_block_stop","index":0}'
    ].join('\n')
    const events = await collect({ fetchFn: fakeFetch(200, sse) })
    expect(events).toContainEqual({ kind: 'thinking', text: 'hmm' })
  })

  it('assembles a tool_use block from input_json_delta fragments', async () => {
    const sse = [
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}',
      '',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
      '',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"Rome\\"}"}}',
      '',
      'data: {"type":"content_block_stop","index":1}',
      '',
      'data: {"type":"message_stop"}'
    ].join('\n')
    const events = await collect({ fetchFn: fakeFetch(200, sse) })
    const calls = events.filter((e) => e.kind === 'toolCall')
    expect(calls).toHaveLength(1)
    const call = (calls[0] as { call: { id: string; name: string; argsJson: string; status: string } }).call
    expect(call.id).toBe('toolu_1')
    expect(call.name).toBe('get_weather')
    expect(JSON.parse(call.argsJson)).toEqual({ city: 'Rome' })
    expect(call.status).toBe('done')
  })

  it('translates abort into a stopped done event', async () => {
    const abort = new AbortController()
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\n'))
        abort.abort()
      }
    })
    const fetchFn = vi.fn(async () => new Response(sseStream, { status: 200 })) as unknown as typeof fetch
    const events = await collect({ fetchFn, signal: abort.signal })
    expect(events[events.length - 1]).toEqual({ kind: 'done', reason: 'stopped' })
  })

  it('throws ChatError with status on a 401', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })) as unknown as typeof fetch
    await expect(collect({ fetchFn })).rejects.toMatchObject({
      name: 'ChatError',
      provider: 'anthropic',
      status: 401
    })
  })

  it('sends a well-formed request (endpoint, headers, system top-level)', async () => {
    const fetchFn = vi.fn(async () => new Response(sseBody('data: {"type":"message_stop"}'), { status: 200 })) as unknown as typeof fetch
    await collect({
      fetchFn,
      system: 'be terse',
      messages: [
        { id: 's1', role: 'system', content: 'ignored', ts: 0 },
        { id: 'u1', role: 'user', content: 'q', ts: 1 }
      ]
    })
    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>
    expect(mock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    const init = mock.mock.calls[0][1]
    expect(init.headers['x-api-key']).toBe('ak-test')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    expect(body.system).toBe('be terse')
    expect(body.messages).toEqual([{ role: 'user', content: 'q' }])
    expect(body.stream).toBe(true)
  })
})

describe('anthropicEndpoint', () => {
  it('defaults to the public API and honors baseUrl', () => {
    expect(anthropicEndpoint(undefined)).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicEndpoint('http://127.0.0.1:8082/')).toBe('http://127.0.0.1:8082/v1/messages')
  })
})

describe('ChatError (anthropic)', () => {
  it('carries provider and status', () => {
    const err = new ChatError('anthropic', 'overloaded', 529)
    expect(err.provider).toBe('anthropic')
    expect(err.status).toBe(529)
  })
})
