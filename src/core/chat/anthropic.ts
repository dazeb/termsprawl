// Phase 11 Task 11.4 — chat driver v2 core: Anthropic streaming adapter.
// Electron-free, zero dependencies: global fetch + the shared SSE reader.
// Speaks /v1/messages with x-api-key auth; system prompt is top-level (never
// inside messages); thinking and tool_use blocks map to ChatEvent.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import { ChatError, type ChatEvent, type ChatMessage, type ChatToolCall } from './types'
import { readSse } from './sse'

export interface StreamAnthropicOptions {
  baseUrl?: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  system?: string
  maxTokens?: number
  signal?: AbortSignal
  fetchFn?: typeof fetch
}

const DEFAULT_BASE = 'https://api.anthropic.com'
const DEFAULT_MAX_TOKENS = 4096

/** Split internal messages into Anthropic's shape: a leading system message
 * (or the explicit system option) becomes the top-level system string; only
 * user/assistant messages go in the messages array. */
export function toAnthropicBody(messages: ChatMessage[], system?: string): {
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  let sys = system
  const rest: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of messages) {
    if (m.role === 'system' && sys === undefined && rest.length === 0) {
      sys = m.content
      continue
    }
    if (m.role === 'user' || m.role === 'assistant') {
      rest.push({ role: m.role, content: m.content })
    }
  }
  return {
    system: sys,
    messages: rest
  }
}

export function anthropicEndpoint(baseUrl?: string): string {
  const base = (baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
  return `${base}/v1/messages`
}

interface ToolBlockAcc {
  id: string
  name: string
  json: string
}

function toolCallFrom(acc: ToolBlockAcc): ChatToolCall {
  const raw = acc.json || '{}'
  try {
    JSON.parse(raw)
    return { id: acc.id, name: acc.name, argsJson: raw, status: 'done' }
  } catch {
    return { id: acc.id, name: acc.name, argsJson: raw, status: 'error', isError: true }
  }
}

export async function* streamAnthropic(opts: StreamAnthropicOptions): AsyncGenerator<ChatEvent> {
  const fetchFn = opts.fetchFn ?? fetch
  const { system, messages } = toAnthropicBody(opts.messages, opts.system)
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
    stream: true
  }
  if (system) body.system = system

  let res: Response
  try {
    res = await fetchFn(anthropicEndpoint(opts.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: opts.signal
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      yield { kind: 'done', reason: 'stopped' }
      return
    }
    throw e
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ChatError('anthropic', `${res.status} ${res.statusText} ${text.slice(0, 200)}`.trim(), res.status)
  }
  if (!res.body) throw new ChatError('anthropic', 'empty response body')

  let inputTokens = 0
  let outputTokens = 0
  let toolAcc: ToolBlockAcc | null = null
  let sawUsage = false
  try {
    for await (const sse of readSse(res.body, opts.signal)) {
      let ev: {
        type?: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
        message?: { usage?: { input_tokens?: number; output_tokens?: number } }
        usage?: { output_tokens?: number; input_tokens?: number }
      }
      try {
        ev = JSON.parse(sse.data)
      } catch {
        continue
      }
      switch (ev.type) {
        case 'message_start':
          inputTokens = ev.message?.usage?.input_tokens ?? 0
          outputTokens = ev.message?.usage?.output_tokens ?? 0
          break
        case 'content_block_start':
          if (ev.content_block?.type === 'tool_use') {
            toolAcc = { id: ev.content_block.id ?? '', name: ev.content_block.name ?? '', json: '' }
          }
          break
        case 'content_block_delta':
          if (ev.delta?.type === 'text_delta' && ev.delta.text) yield { kind: 'delta', text: ev.delta.text }
          else if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
            yield { kind: 'thinking', text: ev.delta.thinking }
          } else if (ev.delta?.type === 'input_json_delta' && toolAcc && ev.delta.partial_json) {
            toolAcc.json += ev.delta.partial_json
          }
          break
        case 'content_block_stop':
          if (toolAcc) {
            yield { kind: 'toolCall', call: toolCallFrom(toolAcc) }
            toolAcc = null
          }
          break
        case 'message_delta':
          if (typeof ev.usage?.output_tokens === 'number') outputTokens = ev.usage.output_tokens
          if (typeof ev.usage?.input_tokens === 'number') inputTokens = ev.usage.input_tokens
          break
        case 'message_stop':
          if (inputTokens > 0 || outputTokens > 0) {
            sawUsage = true
            yield { kind: 'usage', inputTokens, outputTokens, model: opts.model }
          }
          break
        default:
          break
      }
    }
    if (!sawUsage && (inputTokens > 0 || outputTokens > 0)) {
      yield { kind: 'usage', inputTokens, outputTokens, model: opts.model }
    }
    yield { kind: 'done', reason: 'end_turn' }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      yield { kind: 'done', reason: 'stopped' }
      return
    }
    throw e
  }
}
