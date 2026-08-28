// Phase 11 Task 11.4 — chat driver v2 runtime. Shared by the Electron main
// process AND the Server Edition (both build a ChatRuntime with their own
// deps). Owns per-node active runs (abort), pending approvals, event
// broadcasting, and provider/key resolution (env wins over settings — same
// rule as the Telegram token). Electron-free; testable with a fake driver.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import { ChatError } from './types'
import type { ChatEvent, ChatMessage } from './types'
import { streamOpenAI } from './openai'
import { streamAnthropic } from './anthropic'
import { runChatLoop, type ChatDriver } from './tools'

export interface ChatProviderConfig {
  /** provider id/name from settings.apiProviders */
  id: string
  baseUrl: string
  apiKey: string
  /** 'openai' (default, any OpenAI-shaped endpoint) | 'anthropic' */
  api?: 'openai' | 'anthropic'
  model?: string
}

export interface ChatSendRequest {
  nodeId: string
  messages: ChatMessage[]
  model?: string
  /** Provider id from settings.apiProviders; omitted = first configured. */
  provider?: string
}

export interface ChatRuntimeDeps {
  /** Resolve + configure the provider for a send (settings + env aware). */
  resolveProvider(req: ChatSendRequest): ChatProviderConfig | null
  /** Push an event to the renderer (platform.broadcast in main). */
  broadcast(nodeId: string, event: ChatEvent): void
  /** Driver factory — injectable for tests (defaults to the real adapters). */
  driverFor?(cfg: ChatProviderConfig): ChatDriver
  log?(msg: string): void
}

export interface ChatSendResult {
  ok: boolean
  error?: string
  stopReason?: string
}

export interface ChatRuntime {
  send(req: ChatSendRequest): Promise<ChatSendResult>
  stop(nodeId: string): void
  approve(nodeId: string, callId: string, decision: 'approve' | 'deny'): void
  isBusy(nodeId: string): boolean
}

/** Build a ChatDriver for a provider config: Anthropic when api==='anthropic',
 * otherwise the OpenAI-compatible adapter (covers OpenAI/Groq/OpenRouter/
 * LM Studio/llama.cpp/Ollama — any /v1/chat/completions endpoint). */
export function driverFor(cfg: ChatProviderConfig): ChatDriver {
  if (cfg.api === 'anthropic') {
    return {
      stream: (opts) =>
        streamAnthropic({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: opts.model,
          messages: opts.messages,
          signal: opts.signal
        })
    }
  }
  return {
    stream: (opts) =>
      streamOpenAI({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: opts.model,
        messages: opts.messages,
        signal: opts.signal
      })
  }
}

const activeRuns = new Map<string, AbortController>()

export function createChatRuntime(deps: ChatRuntimeDeps): ChatRuntime {
  const pendingApprovals = new Map<string, (d: 'approve' | 'deny') => void>()

  return {
    isBusy(nodeId: string): boolean {
      return activeRuns.has(nodeId)
    },

    stop(nodeId: string): void {
      activeRuns.get(nodeId)?.abort()
    },

    approve(nodeId: string, callId: string, decision: 'approve' | 'deny'): void {
      const resolver = pendingApprovals.get(`${nodeId}:${callId}`)
      if (resolver) {
        pendingApprovals.delete(`${nodeId}:${callId}`)
        resolver(decision)
      }
    },

    async send(req: ChatSendRequest): Promise<ChatSendResult> {
      if (activeRuns.has(req.nodeId)) return { ok: false, error: 'chat already running for this node' }
      const cfg = deps.resolveProvider(req)
      if (!cfg) return { ok: false, error: 'no chat provider configured (Settings → Connections → API providers)' }
      const controller = new AbortController()
      activeRuns.set(req.nodeId, controller)
      const started = Date.now()
      try {
        const driver = deps.driverFor ? deps.driverFor(cfg) : driverFor(cfg)
        const result = await runChatLoop(driver, req.model ?? cfg.model ?? '', [...req.messages], [], {
          onEvent: (e) => deps.broadcast(req.nodeId, e),
          requestApproval: (call) =>
            new Promise<'approve' | 'deny'>((resolve) => {
              // surface the card, then wait for chatApprove (the loop also
              // re-broadcasts the call — dedupe by id in the renderer)
              pendingApprovals.set(`${req.nodeId}:${call.id}`, resolve)
              deps.broadcast(req.nodeId, { kind: 'toolCall', call })
            }),
          signal: controller.signal
        })
        return { ok: true, stopReason: result.stopReason }
      } catch (e) {
        // A user-initiated stop is a normal outcome, not an error — any driver
        // that surfaces the abort (adapter yields done/stopped OR throws
        // AbortError) resolves the send as ok with stopReason 'stopped'.
        if ((e as Error)?.name === 'AbortError') {
          return { ok: true, stopReason: 'stopped' }
        }
        const err = e as ChatError
        deps.broadcast(req.nodeId, { kind: 'done', reason: 'error' })
        return { ok: false, error: err.message ?? String(e) }
      } finally {
        activeRuns.delete(req.nodeId)
        deps.log?.(`chat ${req.nodeId} finished in ${Date.now() - started}ms`)
      }
    }
  }
}
