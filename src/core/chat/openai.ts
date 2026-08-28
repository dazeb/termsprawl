// Phase 11 Task 11.4 — chat driver v2 core: OpenAI-compatible streaming
// adapter. Electron-free, zero dependencies: global fetch + hand-rolled SSE
// parsing. Works with any OpenAI-shaped endpoint (OpenAI, Groq, OpenRouter,
// LM Studio, llama.cpp, Ollama's OpenAI shim — the apiProviders baseUrl model).
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import { ChatError, type ChatEvent, type ChatMessage, type ChatToolCall } from './types'
import { readSse } from './sse'

export interface StreamOpenAIOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: unknown[]
  signal?: AbortSignal
  fetchFn?: typeof fetch
}

const DEFAULT_MAX_TOKENS = 4096

/** Join the configured baseUrl with /chat/completions, appending /v1 when the
 * URL doesn't already contain it (apiProviders store bare origins). */
export function openAiEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return /\/v1(\/|$)/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

/** Map internal messages to the OpenAI wire shape. Tool results become
 * role:'tool' messages carrying the originating tool_call id. */
export function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      const call = m.toolCalls?.[0]
      return { role: 'tool', tool_call_id: call?.id ?? m.id, content: m.content }
    }
    return { role: m.role, content: m.content }
  })
}

interface ToolAcc {
  id: string
  name: string
  args: string
}

function toolCallFrom(acc: ToolAcc): ChatToolCall {
  const raw = acc.args || '{}'
  try {
    JSON.parse(raw)
    return { id: acc.id, name: acc.name, argsJson: raw, status: 'done' }
  } catch {
    return { id: acc.id, name: acc.name, argsJson: raw, status: 'error', isError: true }
  }
}

export async function* streamOpenAI(opts: StreamOpenAIOptions): AsyncGenerator<ChatEvent> {
  const fetchFn = opts.fetchFn ?? fetch
  const wireBody: Record<string, unknown> = {
    model: opts.model,
    messages: toOpenAiMessages(opts.messages),
    stream: true,
    max_tokens: DEFAULT_MAX_TOKENS
  }
  if (opts.tools && opts.tools.length > 0) wireBody.tools = opts.tools

  let res: Response
  try {
    res = await fetchFn(openAiEndpoint(opts.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify(wireBody),
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
    throw new ChatError('openai', `${res.status} ${res.statusText} ${text.slice(0, 200)}`.trim(), res.status)
  }
  if (!res.body) throw new ChatError('openai', 'empty response body')

  const accs = new Map<number, ToolAcc>()
  const yielded = new Set<number>()
  try {
    for await (const sse of readSse(res.body, opts.signal)) {
      if (sse.data === '[DONE]') break
      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string
            reasoning_content?: string
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        model?: string
      }
      try {
        chunk = JSON.parse(sse.data)
      } catch {
        continue
      }
      const delta = chunk.choices?.[0]?.delta
      if (typeof delta?.content === 'string' && delta.content) yield { kind: 'delta', text: delta.content }
      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
        yield { kind: 'thinking', text: delta.reasoning_content }
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = typeof tc.index === 'number' ? tc.index : 0
          const acc = accs.get(i) ?? { id: '', name: '', args: '' }
          if (typeof tc.id === 'string') acc.id += tc.id
          if (typeof tc.function?.name === 'string') acc.name += tc.function.name
          if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments
          accs.set(i, acc)
          // yield the moment the argument JSON is complete (or obviously broken)
          if (!yielded.has(i) && acc.id && acc.name && acc.args) {
            let complete = false
            try {
              JSON.parse(acc.args)
              complete = true
            } catch {
              // not closed yet — keep accumulating
            }
            if (complete) {
              yielded.add(i)
              yield { kind: 'toolCall', call: toolCallFrom(acc) }
            }
          }
        }
      }
      // some providers send a final usage-only chunk (empty choices)
      if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
        yield {
          kind: 'usage',
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          model: chunk.model
        }
      }
    }
    // flush accumulated-but-never-yielded tool calls (incomplete args, empty args)
    for (const [i, acc] of accs) {
      if (!yielded.has(i) && acc.id && acc.name) yield { kind: 'toolCall', call: toolCallFrom(acc) }
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
