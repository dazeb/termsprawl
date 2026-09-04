// Phase 11 Task 11.2 — relay runtime wiring (main process). Holds the live
// RelayClient per connection, maps IPC (relay:connect / relay:status) to it,
// and broadcasts connection state. Also serves live PTY output to a paired
// CLIENT peer when this app runs in relay role 'host' (the relay companion to
// the local-terminal data path). Protocol logic lives in src/core/relay-client
// (envelope seam) and src/core/relay-term (terminal frame protocol) — both
// electron-free and fully tested there. Thin glue.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import { createRelayClient, relayFingerprint, type RelayClient, type RelayPairing } from '../core/relay-client'
import type { RelaySocket, RelaySocketFactory } from '../core/relay-client'
import {
  createTermCoalescer,
  parseRelayTermFrame,
  type RelayTermFrame,
  type TermCoalescer
} from '../core/relay-term'

/**
 * Host-side access to live terminals, supplied by the main process and never
 * hardcoded here. onData subscribes to a terminal's output stream and returns
 * an unsubscribe. When absent, host-role inbound frames are ignored (fail
 * open).
 */
export interface PtyHost {
  list(): Array<{ id: string; title: string }>
  onData(id: string, cb: (data: string) => void): () => void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
}

export interface RelayRuntimeDeps {
  /** Settings-derived dial target. */
  resolveTarget(): { url: string; role: 'host' | 'client'; invite?: string; token?: string } | null
  broadcast(channel: string, payload: unknown): void
  /** Default socket factory uses the real `ws` package in main. */
  socketFactory?: RelaySocketFactory
  /** Host serving surface (only meaningful in relay role 'host'). */
  ptyHost?: PtyHost
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
  /** Send one relay-term frame to the paired HOST (client role only, e.g. an
   * attach/detach/out-inbound request from a remote terminal node). Never
   * throws: returns { ok: false, error } when this app is not a paired
   * client. Host-role frames are served locally, never sent over the tunnel
   * from a terminal this runtime owns. */
  sendTermFrame(frame: RelayTermFrame): { ok: boolean; error?: string }
  disconnect(): void
  /** Frame subscription (audit B7): relay:frame previously broadcast decrypted
   * plaintext on every frame with no listener — a dead channel still pushing
   * data. Frames now flow only while a subscriber is attached. Only reached in
   * relay role 'client'; host-role frames are served locally, never surfaced. */
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
          onError: (cb) => ws.on('error', (e) => cb(e as Error)),
          onClose: (cb) => ws.on('close', () => cb())
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
  let role: 'host' | 'client' = 'client'
  let frameListener: ((frame: { from: string; text: string }) => void) | null = null

  // Per-term attach state when this runtime is the host. Each entry owns the
  // onData subscription and the coalescer feeding that terminal's output.
  const attached = new Map<string, { unsub: () => void; coalescer: TermCoalescer }>()

  const setState = (s: RelayState): void => {
    state = s
    deps.broadcast('relay:status', { state, error })
  }

  /** Unsubscribe every attached term, stop its coalescer, clear state. */
  function teardownHostServing(): void {
    for (const t of attached.values()) {
      t.coalescer.stop()
      t.unsub()
    }
    attached.clear()
  }

  /** Host serving: send one terminal frame to the paired peer (the peer we
   * serve output to). Plain void — the public sendTermFrame is the client-role
   * mirror that goes the other direction. */
  function serveTermFrame(f: RelayTermFrame): void {
    if (!client || !pairing?.peerPub || !pairing.peerLogin) return
    try {
      client.sendFrame(pairing, `client:${pairing.peerLogin}`, JSON.stringify(f))
    } catch (e) {
      deps.log?.(`relay: failed sending terminal frame: ${(e as Error).message}`)
    }
  }

  function attachTerm(term: string): void {
    const ph = deps.ptyHost
    if (!ph) return
    // Unknown term → ignore (fail open); never error the peer.
    if (!ph.list().some((t) => t.id === term)) return
    const existing = attached.get(term)
    if (existing) {
      existing.coalescer.stop()
      existing.unsub()
      attached.delete(term)
    }
    const coalescer = createTermCoalescer((batch) => {
      for (const frame of batch) {
        if (frame.k === 'out') serveTermFrame(frame)
      }
    })
    const unsub = ph.onData(term, (data) => {
      coalescer.push({ v: 1, k: 'out', term, data })
    })
    attached.set(term, { unsub, coalescer })
  }

  function detachTerm(term: string): void {
    const existing = attached.get(term)
    if (!existing) return
    existing.coalescer.stop()
    existing.unsub()
    attached.delete(term)
  }

  /** Serve a parsed relay-term frame from the paired client (host role). */
  function handleHostInbound(_p: RelayPairing, text: string): void {
    const ph = deps.ptyHost
    // No serving surface → ignore (fail open), never error the peer.
    if (!ph) return
    const frame = parseRelayTermFrame(text)
    if (!frame) {
      deps.log?.('relay: dropped unparseable host-role terminal frame')
      return
    }
    switch (frame.k) {
      case 'list':
        try {
          serveTermFrame({ v: 1, k: 'term-list', terms: ph.list() })
        } catch (e) {
          deps.log?.(`relay: term-list failed: ${(e as Error).message}`)
        }
        break
      case 'attach':
        attachTerm(frame.term)
        break
      case 'detach':
        detachTerm(frame.term)
        break
      case 'in':
        try {
          ph.write(frame.term, frame.data)
        } catch (e) {
          deps.log?.(`relay: pty write failed: ${(e as Error).message}`)
        }
        break
      case 'resized':
        try {
          ph.resize(frame.term, frame.cols, frame.rows)
        } catch (e) {
          deps.log?.(`relay: pty resize failed: ${(e as Error).message}`)
        }
        break
      case 'out':
      case 'term-list':
        // Not meaningful inbound from a client; ignore.
        break
    }
  }

  return {
    state: () => state,
    lastError: () => error,

    async connect() {
      if (state === 'connecting' || state === 'paired') return { ok: true }
      const target = deps.resolveTarget()
      if (!target || !target.url) return { ok: false, error: 'no relay configured' }
      error = null
      role = target.role
      setState('connecting')
      try {
        client = await createRelayClient({
          relayUrl: target.url,
          role,
          invite: target.invite,
          githubToken: target.token,
          socketFactory: deps.socketFactory ?? defaultSocketFactory(),
          log: (m) => deps.log?.(m)
        })
        client.onFrame((p, from, text) => {
          if (role === 'client') {
            // Terminal frames over the tunnel are surfaced on a channel ONLY
            // while someone is listening (audit B7 — a dead channel pushing
            // decrypted plaintext every frame is just waste). In host role we
            // never forward; inbound frames are served locally.
            frameListener?.({ from, text: text.slice(0, 2000) })
            return
          }
          handleHostInbound(p, text)
        })
        client.onClose(() => {
          // The transport (and with it the peer) is gone: drop every served
          // term so no orphaned subscription keeps writing into a dead tunnel.
          if (role === 'host') teardownHostServing()
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

    sendTermFrame(frame: RelayTermFrame): { ok: boolean; error?: string } {
      // Only a paired CLIENT sends terminal frames over the tunnel (it mirrors
      // a host's terminal). A host serves inbound frames locally and never
      // sends its own relay-term requests upstream.
      if (role !== 'client') return { ok: false, error: 'relay: host role cannot send terminal frames' }
      if (state !== 'paired' || !client || !pairing) return { ok: false, error: 'relay: not paired' }
      const peerLogin = pairing.peerLogin
      if (!peerLogin) return { ok: false, error: 'relay: not paired' }
      try {
        client.sendFrame(pairing, `host:${peerLogin}`, JSON.stringify(frame))
        return { ok: true }
      } catch (e) {
        const msg = (e as Error).message ?? String(e)
        deps.log?.(`relay: failed sending terminal frame: ${msg}`)
        return { ok: false, error: msg }
      }
    },

    disconnect() {
      teardownHostServing()
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
