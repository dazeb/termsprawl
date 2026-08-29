// Phase 11 Task 11.4 — chat driver v2 core: conversation model. Electron-free,
// zero dependencies. Holds the message list for one chat session, applies
// stream deltas / thinking / usage to messages, parses slash commands, and
// (de)serializes conversations with a byte-capped history window that drops
// oldest user+assistant PAIRS while always keeping a leading system message.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import type { ChatMessage, ChatRole } from './types'

export type { ChatMessage, ChatToolCall } from './types'

export interface Conversation {
  id: string
  messages: ChatMessage[]
  createdAt: number
}

export function createConversation(): Conversation {
  return { id: crypto.randomUUID(), messages: [], createdAt: Date.now() }
}

export function appendMessage(conv: Conversation, role: ChatRole, content: string): ChatMessage {
  const msg: ChatMessage = { id: crypto.randomUUID(), role, content, ts: Date.now() }
  conv.messages.push(msg)
  return msg
}

/** Append streamed text to a message's content; create the message if missing. */
export function appendDelta(conv: Conversation, messageId: string, text: string): ChatMessage {
  const msg = ensureMessage(conv, messageId)
  msg.content += text
  return msg
}

export function appendThinking(conv: Conversation, messageId: string, text: string): ChatMessage {
  const msg = ensureMessage(conv, messageId)
  msg.thinking = (msg.thinking ?? '') + text
  return msg
}

export function setUsage(
  conv: Conversation,
  messageId: string,
  usage: { inputTokens: number; outputTokens: number },
  model?: string
): ChatMessage {
  const msg = ensureMessage(conv, messageId)
  msg.usage = usage
  if (model) msg.model = model
  return msg
}

export function markStopped(conv: Conversation, messageId: string): ChatMessage {
  const msg = ensureMessage(conv, messageId)
  msg.stopped = true
  return msg
}

function ensureMessage(conv: Conversation, messageId: string): ChatMessage {
  const existing = conv.messages.find((m) => m.id === messageId)
  if (existing) return existing
  const created: ChatMessage = { id: messageId, role: 'assistant', content: '', ts: Date.now() }
  conv.messages.push(created)
  return created
}

export type SlashCommandName = 'clear' | 'model' | 'system' | 'cost'

export interface SlashCommand {
  command: SlashCommandName
  arg?: string
}

/** Parse '/clear', '/model <id>', '/system <text>', '/cost'. Case-insensitive
 * on the command word. No leading slash or unknown command → null. */
export function detectSlashCommand(text: string): SlashCommand | null {
  const t = text.trim()
  if (!t.startsWith('/')) return null
  const sp = t.indexOf(' ')
  const word = (sp === -1 ? t : t.slice(0, sp)).toLowerCase()
  const rest = sp === -1 ? '' : t.slice(sp + 1).trim()
  switch (word) {
    case '/clear':
      return { command: 'clear' }
    case '/cost':
      return { command: 'cost' }
    case '/model':
      return rest ? { command: 'model', arg: rest } : { command: 'model' }
    case '/system':
      return rest ? { command: 'system', arg: rest } : { command: 'system' }
    default:
      return null
  }
}

/** Serialize as { v: 1, messages }. If the JSON exceeds maxBytes, drop oldest
 * user+assistant PAIRS until it fits (a leading system message is kept). */
export function serializeConversation(conv: Conversation, maxBytes = 200 * 1024): string {
  const messages = capConversationMessages(conv.messages, maxBytes)
  return JSON.stringify({ v: 1, messages })
}

/** Byte-capped history window: drop oldest user+assistant PAIRS until the
 * serialized message array fits maxBytes (a leading system message survives).
 * Pure helper so node-data persistence can apply the same cap without going
 * through serializeConversation (audit B5 — project.json must stay small). */
export function capConversationMessages(
  messages: ChatMessage[],
  maxBytes = 200 * 1024
): ChatMessage[] {
  let out = JSON.stringify({ v: 1, messages })
  if (out.length <= maxBytes) return messages
  let start = messages.length > 0 && messages[0].role === 'system' ? 1 : 0
  let capped = messages
  while (out.length > maxBytes && start + 1 < capped.length) {
    if (capped[start].role === 'user' && capped[start + 1].role === 'assistant') {
      capped = capped.slice(0, start).concat(capped.slice(start + 2))
    } else {
      start += 1
    }
    out = JSON.stringify({ v: 1, messages: capped })
  }
  return capped
}

/** Parse a serialized conversation. Tolerates unknown fields on messages;
 * throws TypeError on garbage. */
export function deserializeConversation(s: string): Conversation {
  let parsed: unknown
  try {
    parsed = JSON.parse(s)
  } catch {
    throw new TypeError('conversation: invalid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('conversation: not an object')
  }
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.messages)) throw new TypeError('conversation: messages must be an array')
  const messages: ChatMessage[] = []
  for (const raw of obj.messages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('conversation: invalid message')
    }
    const m = raw as Record<string, unknown>
    if (
      typeof m.id !== 'string' ||
      !isValidRole(m.role) ||
      typeof m.content !== 'string' ||
      typeof m.ts !== 'number'
    ) {
      throw new TypeError('conversation: invalid message fields')
    }
    // Copy verbatim (unknown fields survive the round-trip) — the structural
    // checks above guarantee the shape conversation.ts relies on.
    messages.push(m as unknown as ChatMessage)
  }
  return {
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
    messages
  }
}

function isValidRole(v: unknown): v is ChatRole {
  return v === 'user' || v === 'assistant' || v === 'system' || v === 'tool'
}
