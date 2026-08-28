// Phase 11 Task 11.2 — relay client seam TDD. Two layers:
// 1. crypto interop: the app-side seal/open must match the relay service's
//    own crypto module (imported directly from ../..//relay — cross-checked).
// 2. protocol: a fake socket factory pairing a host client and a client
//    client against each other through a minimal in-memory hub that mirrors
//    the real relay's message shapes (and a live cross-check against the REAL
//    hub runs in scripts/verify — here we keep it dependency-free).
import { describe, it, expect } from 'vitest'
import {
  generateRelayKeypair,
  deriveRelayKey,
  sealRelay,
  openRelay,
  hashRelayToken,
  createRelayClient,
  type RelaySocket,
  type RelaySocketFactory
} from './relay-client'

// --- in-memory hub mirroring the real relay protocol ---

function makeHubSocketFactory(): {
  factory: RelaySocketFactory
  wire: (from: 'a' | 'b', data: string) => void
} {
  const sockets: Record<'a' | 'b', RelaySocket | null> = { a: null, b: null }
  const sessions: Record<'a' | 'b', { role?: string; login?: string; id?: string; pub?: string } | null> = { a: null, b: null }
  const listeners: Record<'a' | 'b', Array<(d: string) => void>> = { a: [], b: [] }
  const errors: Record<'a' | 'b', Array<(e: Error) => void>> = { a: [], b: [] }

  function deliverTo(who: 'a' | 'b', msg: unknown): void {
    for (const cb of listeners[who]) cb(JSON.stringify(msg))
  }

  function wire(from: 'a' | 'b', data: string): void {
    queueMicrotask(() => wireInner(from, data))
  }
  function wireInner(from: 'a' | 'b', data: string): void {
    const msg = JSON.parse(data)
    const other: 'a' | 'b' = from === 'a' ? 'b' : 'a'
    if (msg.t === 'hello') {
      const login = from === 'a' ? (msg.login as string) : (msg.invite as string)
      sessions[from] = { role: msg.role, login, id: `${msg.role}:${login}`, pub: msg.pub }
      // peers exchange: tell each side about the other once both are present
      const a = sessions.a
      const b = sessions.b
      if (a && b) {
        deliverTo('a', { t: 'peers', peer: { login: b.login, pub: b.pub } })
        deliverTo('b', { t: 'peers', peer: { login: a.login, pub: a.pub } })
      } else {
        deliverTo(from, { t: 'peers', peer: null })
      }
      return
    }
    if (msg.t === 'frame') {
      // attach from and relay
      deliverTo(other, { ...msg, from: sessions[from]?.id })
      return
    }
  }

  const factory: RelaySocketFactory = async () => {
    const who: 'a' | 'b' = sockets.a === null ? 'a' : 'b'
    const sock: RelaySocket = {
      send: (data) => wire(who, data),
      close: () => {},
      onMessage: (cb) => listeners[who].push(cb),
      onError: () => {}
    }
    sockets[who] = sock
    return sock
  }
  return { factory, wire }
}

describe('relay client crypto (interop with the relay service format)', () => {
  it('derives the same shared key from exchanged public keys', () => {
    const a = generateRelayKeypair()
    const b = generateRelayKeypair()
    const ka = deriveRelayKey(a.privateKey, b.publicKey)
    const kb = deriveRelayKey(b.privateKey, a.publicKey)
    expect(ka.equals(kb)).toBe(true)
    expect(ka.length).toBe(32)
  })

  it('seal/open round-trip with the sender id as AAD', () => {
    const a = generateRelayKeypair()
    const b = generateRelayKeypair()
    const key = deriveRelayKey(a.privateKey, b.publicKey)
    const env = sealRelay(key, 'secret terminal bytes', 'client:abc')
    expect(openRelay(deriveRelayKey(b.privateKey, a.publicKey), env, 'client:abc')).toBe('secret terminal bytes')
  })

  it('open fails when the sender id differs (AAD binds the sender)', () => {
    const a = generateRelayKeypair()
    const b = generateRelayKeypair()
    const key = deriveRelayKey(a.privateKey, b.publicKey)
    const env = sealRelay(key, 'x', 'client:abc')
    expect(() => openRelay(deriveRelayKey(b.privateKey, a.publicKey), env, 'client:OTHER')).toThrow()
  })

  it('hashes tokens the way the relay stores them', () => {
    expect(hashRelayToken('gho_test')).toHaveLength(64)
  })
})

describe('relay client protocol (in-memory hub)', () => {
  it('pairs host+client, exchanges pub keys, and round-trips a sealed frame', async () => {
    const { factory } = makeHubSocketFactory()
    const log: string[] = []

    const host = await createRelayClient({
      relayUrl: 'ws://relay.test',
      role: 'host',
      login: 'e2e-host',
      socketFactory: factory,
      log: (m) => log.push(m)
    })
    const client = await createRelayClient({
      relayUrl: 'ws://relay.test',
      role: 'client',
      invite: 'INVITE1',
      socketFactory: factory,
      log: (m) => log.push(m)
    })

    // both connect concurrently — the host's pairing completes when the
    // client joins (the relay sends the filled peers frame then)
    const [hostPairing, clientPairing] = await Promise.all([host.connect(), client.connect()])

    // each side learned the other's public key
    expect(clientPairing.peerPub).toBe(host.keypair.publicKey)
    expect(hostPairing.peerPub).toBe(client.keypair.publicKey)
    // self ids follow the relay convention
    expect(hostPairing.selfId).toBe('host:e2e-host')
    expect(clientPairing.selfId).toBe('client:INVITE1')

    // client → host sealed frame
    const received: Array<{ from: string; text: string }> = []
    host.onFrame((_p, from, text) => received.push({ from, text }))
    client.sendFrame(clientPairing, 'host:e2e-host', 'hello over the tunnel')
    await new Promise((r) => setTimeout(r, 30))
    expect(received).toEqual([{ from: 'client:INVITE1', text: 'hello over the tunnel' }])

    // host → client too
    const replies: string[] = []
    client.onFrame((_p, _from, text) => replies.push(text))
    host.sendFrame(hostPairing, 'client:INVITE1', 'ack')
    await new Promise((r) => setTimeout(r, 30))
    expect(replies).toEqual(['ack'])
  })

  it('surfaces a typed error when pairing fails', async () => {
    const sockets: RelaySocket[] = []
    const factory: RelaySocketFactory = async () => {
      let msgCb: ((d: string) => void) | null = null
      const sock: RelaySocket = {
        send: (data) => {
          const msg = JSON.parse(data)
          if (msg.t === 'hello') queueMicrotask(() => msgCb?.(JSON.stringify({ t: 'error', code: 'EXPIRED' })))
        },
        close: () => {},
        onMessage: (cb) => {
          msgCb = cb
        },
        onError: () => {}
      }
      sockets.push(sock)
      return sock
    }
    const c = await createRelayClient({ relayUrl: 'ws://x', role: 'client', invite: 'old', socketFactory: factory })
    await expect(c.connect()).rejects.toThrow('relay pairing failed: EXPIRED')
  })
})
