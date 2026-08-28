// Phase 11 Task 11.4 — chat driver v2 core types. Electron-free, zero
// dependencies: the shared vocabulary for conversation state, streaming
// events, and provider errors. Both SSE adapters (openai.ts, anthropic.ts)
// and the tool loop (tools.ts) speak only in these types.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatToolCall {
  id: string
  name: string
  /** Arguments as a JSON string (accumulated from provider stream fragments). */
  argsJson: string
  result?: string
  isError?: boolean
  status: 'running' | 'done' | 'error'
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Assistant reasoning stream (separate from user-visible content). */
  thinking?: string
  toolCalls?: ChatToolCall[]
  usage?: { inputTokens: number; outputTokens: number }
  model?: string
  /** True when the user aborted this message mid-stream. */
  stopped?: boolean
  /** Epoch millis. */
  ts: number
}

export type ChatEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; model?: string }
  | { kind: 'toolCall'; call: ChatToolCall }
  | { kind: 'done'; reason: 'end_turn' | 'stopped' | 'error' | 'max_iterations' }

export class ChatError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'ChatError'
  }
}
