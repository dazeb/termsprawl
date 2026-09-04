// Phase 11 Task 11.2 — relay runtime wiring (main process). Holds the live
// RelayClient per connection, maps IPC (relay:connect / relay:status) to it,
// and broadcasts connection state. Thin: protocol logic lives in
// src/core/relay-client (electron-free, fully tested there).
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import { createRelayClient, relayFingerprint, type RelayClient, type RelayPairing } from '../core/relay-client'
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

export interface RelayPairingInfo {
  peerLogin: string | null
  peerPub: string | null
  selfId: string
  /** Human-readable 8-group fingerprint of peerPub, for eyeball confirmation. */
  fingerprint: string | null
}

export interface RelayRuntime {
  state(): RelayState
  lastError(): string | null
  connect(): Promise<{ ok: boolean; error?: string; pairing?: RelayPairingInfo }>
  /** Ask the live paired client to mint a fresh invite code (host role). */
  mintInvite(): Promise<{ ok: boolean; code?: string; error?: string }>
  disconnect(): void
  /** Frame subscription (audit B7): relay:frame previously broadcast decrypted
   * plaintext on every frame with no listener — a dead channel still pushing
   * data. Frames now flow only while a subscriber is attached. */
  setFrameListener(listener: ((frame: { from: string; text: string }) => void) | null): void
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
  let frameListener: ((frame: { from: string; text: string }) => void) | null = null

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
          // terminal frames over the tunnel are a follow-up; surface frames on
          // a channel ONLY while someone is listening (audit B7 — a dead
          // channel pushing decrypted plaintext every frame is just waste).
          frameListener?.({ from, text: text.slice(0, 2000) })
        })
        pairing = await client.connect()
        setState('paired')
        deps.log?.(`relay paired with ${pairing.peerLogin ?? 'unknown peer'}`)
        const info: RelayPairingInfo = {
          peerLogin: pairing.peerLogin,
          peerPub: pairing.peerPub,
          selfId: pairing.selfId,
          fingerprint: pairing.peerPub ? relayFingerprint(pairing.peerPub) : null
        }
        return { ok: true, pairing: info }
      } catch (e) {
        error = (e as Error).message ?? String(e)
        setState('error')
        return { ok: false, error }
      }
    },

    async mintInvite(): Promise<{ ok: boolean; code?: string; error?: string }> {
      if (state !== 'paired' || !client) return { ok: false, error: 'not paired' }
      try {
        const code = await client.mintInvite()
        return { ok: true, code }
      } catch (e) {
        return { ok: false, error: (e as Error).message ?? String(e) }
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
    },

    setFrameListener(listener: ((frame: { from: string; text: string }) => void) | null): void {
      frameListener = listener
    }
  }
}
