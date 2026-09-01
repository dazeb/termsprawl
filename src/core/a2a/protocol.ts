// A2A protocol primitives (Phase 19) — Google Agent2Agent, JSON-RPC 2.0 over
// HTTP. Pure functions only: build requests, validate agent cards, and parse
// responses/errors. Never throws; junk in → null / ok:false out.
// Electron-free AND browser-safe: no node imports (the renderer imports this
// for peer testing) — randomUUID comes from the platform global.
// Clean-room: written fresh for termsprawl.

/** A peer agent's self-description (the discoverable subset we use). */
export interface AgentCard {
  name: string
  url?: string
  description?: string
  version?: string
  skills?: Array<{ id?: string; name?: string; description?: string }>
}

export interface MessageSendBody {
  jsonrpc: '2.0'
  id: number | string
  method: 'message/send'
  params: {
    message: {
      role: 'user'
      kind: 'message'
      messageId: string
      parts: Array<{ kind: 'text'; text: string }>
    }
  }
}

/** Build a `message/send` JSON-RPC body. Total: embeds whatever text it gets. */
export function buildMessageSend(text: string, opts?: { id?: number | string }): MessageSendBody {
  return {
    jsonrpc: '2.0',
    id: opts?.id ?? 1,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        kind: 'message',
        messageId: `tsprawl-${globalThis.crypto.randomUUID()}`,
        parts: [{ kind: 'text', text }]
      }
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse + validate an agent card; null on junk. */
export function parseAgentCard(raw: unknown): AgentCard | null {
  if (!isRecord(raw)) return null
  if (typeof raw.name !== 'string' || raw.name.length === 0) return null
  const card: AgentCard = { name: raw.name }
  if (typeof raw.url === 'string') card.url = raw.url
  if (typeof raw.description === 'string') card.description = raw.description
  if (typeof raw.version === 'string') card.version = raw.version
  if (raw.skills !== undefined) {
    if (!Array.isArray(raw.skills)) return null
    const skills: AgentCard['skills'] = []
    for (const s of raw.skills) {
      if (!isRecord(s)) return null
      skills.push({
        ...(typeof s.id === 'string' ? { id: s.id } : {}),
        ...(typeof s.name === 'string' ? { name: s.name } : {}),
        ...(typeof s.description === 'string' ? { description: s.description } : {})
      })
    }
    card.skills = skills
  }
  return card
}

export type A2aResponseText =
  | { ok: true; text: string }
  | { ok: true; task: { id: string; state: string } }
  | { ok: false; error: string }

/**
 * Interpret a JSON-RPC `result`: a Message (concatenate text parts) or a Task
 * (id + state summary). Any junk degrades to ok:false — never throws.
 */
export function extractResponseText(result: unknown): A2aResponseText {
  const fail: A2aResponseText = { ok: false, error: 'response contained no text parts' }
  if (!isRecord(result)) return fail
  if (result.kind === 'task') {
    const id = typeof result.id === 'string' || typeof result.id === 'number' ? String(result.id) : ''
    const status = isRecord(result.status) ? result.status : {}
    const state = typeof status.state === 'string' ? status.state : 'unknown'
    return { ok: true, task: { id, state } }
  }
  if (Array.isArray(result.parts)) {
    const texts: string[] = []
    for (const part of result.parts) {
      if (isRecord(part) && part.kind === 'text' && typeof part.text === 'string') {
        texts.push(part.text)
      }
    }
    if (texts.length > 0) return { ok: true, text: texts.join('\n') }
  }
  return fail
}

/** Human-readable JSON-RPC error, or null when the body carries none. */
export function parseRpcError(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null
  const { code, message } = body.error
  if (typeof code !== 'number' || typeof message !== 'string') return null
  return `RPC error ${code}: ${message}`
}

/** True for a well-formed JSON-RPC 2.0 response (result or error present). */
export function isRpcResponse(body: unknown): boolean {
  if (!isRecord(body) || body.jsonrpc !== '2.0') return false
  return 'result' in body || 'error' in body
}
