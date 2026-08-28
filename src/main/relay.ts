// Phase 11 Task 11.2 — relay runtime wiring (main process). Holds the live
// RelayClient per connection, maps IPC (relay:connect / relay:status) to it,
// and broadcasts connection state. Thin: protocol logic lives in
// src/core/relay-client (electron-free, fully tested there).
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import { createRelayClient, type RelayClient, type RelayPairing } from '../core/relay-client'
import type { RelaySocket, RelaySocketFactory } from '../core/relay-client'

export interface RelayRuntimeDeps {
  /** Settings-derived dial target. */
  resolveTarget(): { url: string; role: 'host' | 'client'; invite?: string; token?: string } | null
  broadcast(channel: string, payload: unknown): void
  /** Default socket factory uses the real `ws` package in main. */
  socketFactory?: RelaySocketFactory
  log?(msg: string): void
}

export type RelayState = 'disconnected' | 'connecting' | 'paired' | 'error'

export interface RelayRuntime {
  state(): RelayState
  lastError(): string | null
  connect(): Promise<{ ok: boolean; error?: string; pairing?: { peerLogin: string | null; selfId: string } }>
  disconnect(): void
}

// The real socket factory lives here (not in core) so core stays dependency-free.
export function defaultSocketFactory(): RelaySocketFactory {
  return async (url) => {
    const { WebSocket } = await import('ws')
    return await new Promise<RelaySocket>((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.on('open', () =>
        resolve({
          send: (data) => ws.send(data),
          close: () => ws.close(),
          onMessage: (cb) => ws.on('message', (d) => cb(String(d))),
          onError: (cb) => ws.on('error', (e) => cb(e as Error))
        })
      )
      ws.on('error', reject)
    })
  }
}

export function createRelayRuntime(deps: RelayRuntimeDeps): RelayRuntime {
  let state: RelayState = 'disconnected'
  let error: string | null = null
  let client: RelayClient | null = null
  let pairing: RelayPairing | null = null

  const setState = (s: RelayState): void => {
    state = s
    deps.broadcast('relay:status', { state, error })
  }

  return {
    state: () => state,
    lastError: () => error,

    async connect() {
      if (state === 'connecting' || state === 'paired') return { ok: true }
      const target = deps.resolveTarget()
      if (!target || !target.url) return { ok: false, error: 'no relay configured' }
      error = null
      setState('connecting')
      try {
        client = await createRelayClient({
          relayUrl: target.url,
          role: target.role,
          invite: target.invite,
          githubToken: target.token,
          socketFactory: deps.socketFactory ?? defaultSocketFactory(),
          log: (m) => deps.log?.(m)
        })
        client.onFrame((_p, from, text) => {
          // terminal frames over the tunnel are a follow-up; surface frames
          // on a channel so the future UI (or an agent) can subscribe
          deps.broadcast('relay:frame', { from, text: text.slice(0, 2000) })
        })
        pairing = await client.connect()
        setState('paired')
        deps.log?.(`relay paired with ${pairing.peerLogin ?? 'unknown peer'}`)
        return { ok: true, pairing: { peerLogin: pairing.peerLogin, selfId: pairing.selfId } }
      } catch (e) {
        error = (e as Error).message ?? String(e)
        setState('error')
        return { ok: false, error }
      }
    },

    disconnect() {
      try {
        client?.close()
      } catch {
        // already gone
      }
      client = null
      pairing = null
      setState('disconnected')
    }
  }
}
