// A2A client (Phase 19) — send messages to a configured A2A peer over
// JSON-RPC 2.0 / HTTP. Injectable fetch + mandatory timeouts (a hung request
// must never hang an agent); every failure path returns ok:false, never throws.
// Style mirrors core/telegram/api.ts (the house injectable-fetch pattern).
import {
  buildMessageSend,
  extractResponseText,
  isRpcResponse,
  parseAgentCard,
  parseRpcError,
  type A2aResponseText,
  type AgentCard
} from './protocol'

export interface A2AFetchDeps {
  fetch?: typeof globalThis.fetch
}

export interface A2ACallOpts extends A2AFetchDeps {
  /** Bearer token for peers that require one. */
  token?: string
  /** Default 15000 — a hung peer must not hang the caller. */
  timeoutMs?: number
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function defaultFetch(deps?: A2AFetchDeps): typeof globalThis.fetch {
  return deps?.fetch ?? globalThis.fetch
}

function headers(opts?: A2ACallOpts): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (opts?.token) h.Authorization = `Bearer ${opts.token}`
  return h
}

async function request(
  url: string,
  init: RequestInit,
  opts?: A2ACallOpts
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000)
  try {
    return await defaultFetch(opts)(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Discover an agent's card at `<endpoint>/.well-known/agent-card.json`. */
export async function discoverAgentCard(
  endpoint: string,
  opts?: A2ACallOpts
): Promise<{ ok: true; card: AgentCard } | { ok: false; error: string }> {
  const url = `${trimTrailingSlash(endpoint)}/.well-known/agent-card.json`
  try {
    const res = await request(url, { method: 'GET', headers: headers(opts) }, opts)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      return { ok: false, error: 'invalid JSON from agent card' }
    }
    const card = parseAgentCard(parsed)
    if (!card) return { ok: false, error: 'invalid agent card' }
    return { ok: true, card }
  } catch (err) {
    return { ok: false, error: `agent card request failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export type A2aSendResult = A2aResponseText

/**
 * Send one text message to an A2A peer (`message/send`). Returns the agent's
 * text reply, a task summary for long-running peers, or an error.
 */
export async function sendText(
  endpoint: string,
  text: string,
  opts?: A2ACallOpts
): Promise<A2aSendResult> {
  if (text.trim().length === 0) return { ok: false, error: 'empty message' }
  const url = `${trimTrailingSlash(endpoint)}/`
  try {
    const res = await request(
      url,
      { method: 'POST', headers: headers(opts), body: JSON.stringify(buildMessageSend(text)) },
      opts
    )
    if (!res.ok) {
      // Prefer a structured RPC error when the body carries one.
      let richer: string | null = null
      try {
        richer = parseRpcError(await res.json())
      } catch {
        // body was not JSON — the HTTP status is the honest message
      }
      return { ok: false, error: richer ?? `HTTP ${res.status}` }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: 'invalid JSON-RPC response' }
    }
    if (!isRpcResponse(body)) return { ok: false, error: 'invalid JSON-RPC response' }
    const rpcError = parseRpcError(body)
    if (rpcError) return { ok: false, error: rpcError }
    return extractResponseText(body && typeof body === 'object' ? (body as Record<string, unknown>).result : null)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `A2A request failed: ${reason}` }
  }
}
