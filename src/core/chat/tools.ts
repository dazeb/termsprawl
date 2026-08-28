// Phase 11 Task 11.4 — chat driver v2 core: provider-neutral tool loop with a
// permission gate. Electron-free, pure. Drives a ChatDriver turn by turn,
// forwarding stream events, executing approved tools, and feeding tool results
// back until the model stops calling tools (or the loop guard fires).
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import type { ChatEvent, ChatMessage, ChatToolCall } from './types'

export interface ChatToolDef {
  name: string
  description: string
  schema: unknown
  needsApproval: boolean
  run(args: unknown): Promise<string>
}

export type ApprovalDecision = 'approve' | 'deny'

/** Minimal surface both SSE adapters satisfy. */
export interface ChatDriver {
  stream(opts: {
    model: string
    messages: ChatMessage[]
    tools?: unknown[]
    signal?: AbortSignal
  }): AsyncIterable<ChatEvent>
}

export interface ChatLoopHooks {
  onEvent(e: ChatEvent): void
  requestApproval(call: ChatToolCall): Promise<ApprovalDecision>
  maxIterations?: number
  /** Abort signal: when fired, the current stream is cut and the loop returns
   * with stopReason 'end_turn' (the stopped flag lands on the message). */
  signal?: AbortSignal
}

export interface ChatLoopResult {
  messages: ChatMessage[]
  stopReason: 'end_turn' | 'max_iterations' | 'denied'
}

const DEFAULT_MAX_ITERATIONS = 10

function newMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, ts: Date.now() }
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    toolCalls: m.toolCalls ? m.toolCalls.map((c) => ({ ...c })) : undefined
  }))
}

function appendToolResult(
  messages: ChatMessage[],
  call: ChatToolCall,
  result: string,
  isError: boolean
): void {
  const finished: ChatToolCall = { ...call, result, isError, status: isError ? 'error' : 'done' }
  // mirror the result onto the assistant message that requested the call
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const tc = m.toolCalls?.find((c) => c.id === call.id)
    if (tc) {
      tc.result = result
      tc.isError = isError
      tc.status = isError ? 'error' : 'done'
      break
    }
  }
  messages.push({
    id: crypto.randomUUID(),
    role: 'tool',
    content: result,
    toolCalls: [finished],
    ts: Date.now()
  })
}

/** Append (or return) the in-flight assistant message. */
function ensureAssistant(messages: ChatMessage[], current: ChatMessage | null): ChatMessage {
  if (current) return current
  const created = newMessage('assistant', '')
  messages.push(created)
  return created
}

export async function runChatLoop(
  driver: ChatDriver,
  model: string,
  messages: ChatMessage[],
  tools: ChatToolDef[],
  hooks: ChatLoopHooks
): Promise<ChatLoopResult> {
  const working = cloneMessages(messages)
  const maxIterations = hooks.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const max = Math.max(1, maxIterations)

  for (let iteration = 0; iteration < max; iteration++) {
    let current: ChatMessage | null = null
    const pending: ChatToolCall[] = []
    let stopped = false

    for await (const ev of driver.stream({ model, messages: working, tools, signal: hooks.signal })) {
      try {
        hooks.onEvent(ev)
      } catch {
        // a broken consumer must never kill the loop
      }
      if (ev.kind === 'delta' || ev.kind === 'thinking') {
        current = ensureAssistant(working, current)
        if (ev.kind === 'delta') current.content += ev.text
        else current.thinking = (current.thinking ?? '') + ev.text
      } else if (ev.kind === 'usage') {
        current = ensureAssistant(working, current)
        current.usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens }
        if (ev.model) current.model = ev.model
      } else if (ev.kind === 'toolCall') {
        current = ensureAssistant(working, current)
        current.toolCalls = [...(current.toolCalls ?? []), { ...ev.call }]
        pending.push(ev.call)
      } else if (ev.kind === 'done' && ev.reason === 'stopped') {
        stopped = true
      }
    }

    if (current) {
      current.content = current.content || ''
      if (stopped) current.stopped = true
    }
    if (stopped) return { messages: working, stopReason: 'end_turn' }
    if (pending.length === 0) return { messages: working, stopReason: 'end_turn' }

    for (const call of pending) {
      const def = tools.find((t) => t.name === call.name)
      if (!def) {
        appendToolResult(working, call, `unknown tool: ${call.name}`, true)
        continue
      }
      if (def.needsApproval) {
        let decision: ApprovalDecision
        try {
          decision = await hooks.requestApproval(call)
        } catch {
          decision = 'deny'
        }
        if (decision === 'deny') {
          appendToolResult(working, call, 'denied by user', true)
          return { messages: working, stopReason: 'denied' }
        }
      }
      let result: string
      let isError = false
      try {
        let args: unknown = {}
        if (call.argsJson) args = JSON.parse(call.argsJson)
        result = await def.run(args)
      } catch (e) {
        result = `tool error: ${(e as Error)?.message ?? String(e)}`
        isError = true
      }
      appendToolResult(working, call, result, isError)
    }
  }

  working.push(newMessage('system', 'stopped: tool loop iteration limit reached'))
  return { messages: working, stopReason: 'max_iterations' }
}
