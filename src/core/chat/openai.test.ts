// Phase 11 Task 11.4 — chat driver v2 core: OpenAI adapter TDD. Fake fetch,
// canned SSE bodies, no network.
import { describe, it, expect, vi } from 'vitest'
import { streamOpenAI, openAiEndpoint, toOpenAiMessages, type StreamOpenAIOptions } from './openai'
import { ChatError, type ChatEvent } from './types'

/** Build a ReadableStream body from raw SSE text. */
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
  return vi.fn(async () =>
    new Response(bodyText === null ? null : sseBody(bodyText), {
      status,
      headers: { 'content-type': 'text/event-stream' }
    })
  ) as unknown as typeof fetch
}

const baseOpts = {
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  messages: [{ id: 'u1', role: 'user' as const, content: 'hi', ts: 1 }]
}

async function collect(opts: Partial<StreamOpenAIOptions>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const ev of streamOpenAI({ ...baseOpts, ...opts })) events.push(ev)
  return events
}

describe('openAiEndpoint', () => {
  it('appends /v1 to a bare origin', () => {
    expect(openAiEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions')
  })
  it('does not double /v1', () => {
    expect(openAiEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions')
    expect(openAiEndpoint('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1/chat/completions')
  })
})

describe('toOpenAiMessages', () => {
  it('maps tool results to role tool with tool_call_id', () => {
    const out = toOpenAiMessages([
      { id: 'm1', role: 'user', content: 'run it', ts: 1 },
      {
        id: 'm2',
        role: 'tool',
        content: 'result text',
        ts: 2,
        toolCalls: [{ id: 'call_9', name: 'run', argsJson: '{}', status: 'done' }]
      }
    ])
    expect(out[0]).toEqual({ role: 'user', content: 'run it' })
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'call_9', content: 'result text' })
  })

  it('replays assistant toolCalls as the tool_calls field (audit B3)', () => {
    const out = toOpenAiMessages([
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        ts: 1,
        toolCalls: [{ id: 'call_1', name: 'read_file', argsJson: '{"path":"/p"}', status: 'done' }]
      },
      { id: 'm2', role: 'tool', content: 'body', ts: 2, toolCalls: [{ id: 'call_1', name: 'read_file', argsJson: '{}', status: 'done' }] }
    ])
    expect(out[0]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/p"}' } }
      ]
    })
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'body' })
  })

  it('drops note messages from the wire (audit B4)', () => {
    const out = toOpenAiMessages([
      { id: 'm1', role: 'user', content: 'q', ts: 1 },
      { id: 'm2', role: 'note', content: '1,234 tokens so far', ts: 2 },
      { id: 'm3', role: 'assistant', content: 'a', ts: 3 }
    ])
    expect(out).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ])
  })
})

describe('streamOpenAI', () => {
  it('yields ordered deltas then done', async () => {
    const fetchFn = fakeFetch(
      200,
      [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        '',
        'data: [DONE]',
        ''
      ].join('\n')
    )
    const events = await collect({ fetchFn })
    expect(events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text)).toEqual(['Hel', 'lo'])
    expect(events[events.length - 1]).toEqual({ kind: 'done', reason: 'end_turn' })
  })

  it('maps reasoning_content to thinking (CRLF + keepalive comment tolerated)', async () => {
    const fetchFn = fakeFetch(
      200,
      ': keepalive\r\n\r\ndata: {"choices":[{"delta":{"reasoning_content":"pondering"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"answer"}}]}\r\n\r\ndata: [DONE]\r\n'
    )
    const events = await collect({ fetchFn })
    expect(events).toContainEqual({ kind: 'thinking', text: 'pondering' })
    expect(events).toContainEqual({ kind: 'delta', text: 'answer' })
  })

  it('assembles tool_calls split across chunks into one complete toolCall', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_wea"}}]}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"ther","arguments":"{\\"city\\":"}}]}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Paris\\"}"}}]}}]}',
      '',
      'data: [DONE]'
    ].join('\n')
    const events = await collect({ fetchFn: fakeFetch(200, sse) })
    const calls = events.filter((e) => e.kind === 'toolCall')
    expect(calls).toHaveLength(1)
    const call = (calls[0] as { call: { id: string; name: string; argsJson: string; status: string } }).call
    expect(call.id).toBe('call_1')
    expect(call.name).toBe('get_weather')
    expect(JSON.parse(call.argsJson)).toEqual({ city: 'Paris' })
    expect(call.status).toBe('done')
  })

  it('yields usage from a usage-only chunk', async () => {
    const fetchFn = fakeFetch(
      200,
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5},"model":"gpt-4o"}\n\ndata: [DONE]'
    )
    const events = await collect({ fetchFn })
    expect(events).toContainEqual({ kind: 'usage', inputTokens: 10, outputTokens: 5, model: 'gpt-4o' })
  })

  it('translates abort into a stopped done event', async () => {
    const abort = new AbortController()
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder()
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"par"}}]}\n\n'))
        // never closes — the abort must break the read loop
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
      provider: 'openai',
      status: 401
    })
  })

  it('sends a well-formed request (url, bearer, stream flag)', async () => {
    const fetchFn = vi.fn(async () => new Response(sseBody('data: [DONE]'), { status: 200 })) as unknown as typeof fetch
    await collect({ fetchFn })
    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>
    expect(mock.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions')
    const init = mock.mock.calls[0][1]
    expect(init.headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('gpt-4o')
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' })
  })
})

describe('ChatError', () => {
  it('carries provider and status', () => {
    const err = new ChatError('openai', 'boom', 429)
    expect(err.provider).toBe('openai')
    expect(err.status).toBe(429)
    expect(err.message).toBe('boom')
  })
})
