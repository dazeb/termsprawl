// Phase 11 Task 11.2 — relay runtime wiring TDD. Fake socket factory; asserts
// state transitions + settings-driven target resolution + frame surfacing.
import { describe, it, expect, vi } from 'vitest'
import { createRelayRuntime, type RelayRuntimeDeps } from './relay'
import { relayFingerprint, type RelaySocket, type RelaySocketFactory } from '../core/relay-client'

function fakeSocketFactory(script: (send: (data: string) => void) => void) {
  return async (): Promise<RelaySocket> => {
    const listeners: Array<(d: string) => void> = []
    const sock: RelaySocket = {
      send: (data) => queueMicrotask(() => script((out) => listeners.forEach((cb) => cb(out)))),
      close: () => {},
      onMessage: (cb) => listeners.push(cb),
      onError: () => {}
    }
    return sock
  }
}

function makeDeps(factory: RelaySocketFactory, target: { url: string; role: 'host' | 'client'; invite?: string } | null): RelayRuntimeDeps & { events: Array<{ channel: string; payload: unknown }> } {
  const events: Array<{ channel: string; payload: unknown }> = []
  return {
    events,
    resolveTarget: () => target,
    broadcast: (channel, payload) => events.push({ channel, payload }),
    socketFactory: factory,
    log: vi.fn()
  }
}

// A valid 32-byte X25519 public key (base64) + its relay fingerprint, so the
// connect result can surface peerPub/fingerprint without relayFingerprint
// throwing on a too-short stub.
const VALID_PUB = Buffer.alloc(32, 7).toString('base64')
const VALID_PUB_FP = relayFingerprint(VALID_PUB)

// A message-aware socket factory: the handler inspects each outgoing frame and
// replies (hello → filled peers, invite-create → invite or error).
function messageSocketFactory(replies: { hello: unknown; inviteCreate: unknown }) {
  const factory: RelaySocketFactory = async () => {
    let msgCb: ((d: string) => void) | null = null
    const sock: RelaySocket = {
      send: (data) => {
        const msg = JSON.parse(data) as { t?: string }
        if (msg.t === 'hello') queueMicrotask(() => msgCb?.(JSON.stringify(replies.hello)))
        if (msg.t === 'invite-create') queueMicrotask(() => msgCb?.(JSON.stringify(replies.inviteCreate)))
      },
      close: () => {},
      onMessage: (cb) => {
        msgCb = cb
      },
      onError: () => {}
    }
    return sock
  }
  return factory
}

describe('relay runtime', () => {
  it('connects, pairs, and reports state transitions', async () => {
    const factory = fakeSocketFactory((send) => {
      // respond to hello with a pairing ack (client role → filled peers frame)
      send(JSON.stringify({ t: 'peers', peer: { login: 'app-host', pub: VALID_PUB } }))
    })
    const deps = makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'INV1' })
    const rt = createRelayRuntime(deps)
    expect(rt.state()).toBe('disconnected')
    const res = await rt.connect()
    expect(res.ok).toBe(true)
    expect(res.pairing?.peerLogin).toBe('app-host')
    expect(rt.state()).toBe('paired')
    const states = deps.events.filter((e) => e.channel === 'relay:status').map((e) => (e.payload as { state: string }).state)
    expect(states).toEqual(['connecting', 'paired'])
  })

  it('surfaces the peer public key and fingerprint in the connect result', async () => {
    const factory = fakeSocketFactory((send) => {
      send(JSON.stringify({ t: 'peers', peer: { login: 'app-host', pub: VALID_PUB } }))
    })
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'INV1' }))
    const res = await rt.connect()
    expect(res.ok).toBe(true)
    expect(res.pairing?.peerPub).toBe(VALID_PUB)
    expect(res.pairing?.fingerprint).toBe(VALID_PUB_FP)
    // 8 space-separated hex groups of 4 chars each
    expect(res.pairing?.fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){7}$/)
    expect(res.pairing?.peerPub).not.toBeNull()
  })

  it('reports an error state when pairing fails', async () => {
    const factory = fakeSocketFactory((send) => {
      send(JSON.stringify({ t: 'error', code: 'EXPIRED' }))
    })
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'OLD' }))
    const res = await rt.connect()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('EXPIRED')
    expect(rt.state()).toBe('error')
  })

  it('refuses to connect with no relay configured', async () => {
    const factory = fakeSocketFactory(() => {})
    const rt = createRelayRuntime(makeDeps(factory, null))
    const res = await rt.connect()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('no relay configured')
    expect(rt.state()).toBe('disconnected')
  })

  it('disconnect resets to disconnected state', async () => {
    const factory = fakeSocketFactory((send) => {
      send(JSON.stringify({ t: 'peers', peer: { login: 'h', pub: VALID_PUB } }))
    })
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://r', role: 'client', invite: 'I' }))
    await rt.connect()
    rt.disconnect()
    expect(rt.state()).toBe('disconnected')
  })

  it('mintInvite delegates to the paired client and returns the code', async () => {
    const factory = messageSocketFactory({
      hello: { t: 'peers', peer: { login: 'app-host', pub: VALID_PUB } },
      inviteCreate: { t: 'invite', code: 'ABCD1234' }
    })
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'INV1' }))
    const connected = await rt.connect()
    expect(connected.ok).toBe(true)
    const res = await rt.mintInvite()
    expect(res.ok).toBe(true)
    expect(res.code).toBe('ABCD1234')
  })

  it('mintInvite returns not-paired when disconnected', async () => {
    const factory = fakeSocketFactory(() => {})
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'INV1' }))
    const res = await rt.mintInvite()
    expect(res.ok).toBe(false)
    expect(res.error).toBe('not paired')
  })

  it('mintInvite maps a client error into an error result', async () => {
    const factory = messageSocketFactory({
      hello: { t: 'peers', peer: { login: 'app-host', pub: VALID_PUB } },
      inviteCreate: { t: 'error', code: 'QUOTA' }
    })
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'INV1' }))
    const connected = await rt.connect()
    expect(connected.ok).toBe(true)
    const res = await rt.mintInvite()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('QUOTA')
  })
})
