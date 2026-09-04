// Phase 11 Task 11.2 — relay runtime wiring TDD. Fake socket factory; asserts
// state transitions + settings-driven target resolution + frame surfacing.
import { describe, it, expect, vi } from 'vitest'
import { createRelayRuntime, type RelayRuntimeDeps, type PtyHost } from './relay'
import {
  relayFingerprint,
  generateRelayKeypair,
  deriveRelayKey,
  sealRelay,
  openRelay,
  type RelaySocket,
  type RelaySocketFactory
} from '../core/relay-client'
import { parseRelayTermFrame, type RelayTermFrame } from '../core/relay-term'

function fakeSocketFactory(script: (send: (data: string) => void) => void) {
  return async (): Promise<RelaySocket> => {
    const listeners: Array<(d: string) => void> = []
    const sock: RelaySocket = {
      send: (data) => queueMicrotask(() => script((out) => listeners.forEach((cb) => cb(out)))),
      close: () => {},
      onMessage: (cb) => listeners.push(cb),
      onError: () => {},
      onClose: () => {}
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
      onError: () => {},
      onClose: () => {}
    }
    return sock
  }
  return factory
}

// A real X25519 keypair for the fake PEER the runtime pairs with, plus a socket
// that relays hello/frame messages so the test can decrypt the runtime's
// outbound envelopes and seal inbound ones (the runtime's own keypair is
// internal and never exposed).
interface RelayHarness {
  factory: RelaySocketFactory
  peerPub: string
  /** Deliver an inbound relay-term frame as if sealed by the paired peer. */
  deliver(frame: RelayTermFrame): void
  /** Deliver an inbound RAW (already-JSON) frame as if sealed by the peer. */
  deliverRaw(text: string): void
  /** Outbound envelopes the runtime sent, decoded back to relay-term frames. */
  outbound: Array<{ to: string; frame: RelayTermFrame | null; raw: string }>
  /** Simulate the transport closing (peer gone). */
  fireClose(): void
  isClosed(): boolean
}

function makeHarness(peer: { role: 'host' | 'client'; login: string }): RelayHarness {
  const peerKey = generateRelayKeypair()
  const peerId = `${peer.role}:${peer.login}`
  let peerPub = ''
  let runtimeSelfId = ''
  const msgListeners: Array<(d: string) => void> = []
  let closeCb: (() => void) | null = null
  const outbound: RelayHarness['outbound'] = []

  const sock: RelaySocket = {
    send: (data) => {
      const msg = JSON.parse(data) as Record<string, unknown>
      if (msg.t === 'hello') {
        peerPub = String(msg.pub)
        const role = msg.role === 'host' ? 'host' : 'client'
        runtimeSelfId =
          role === 'host' ? `host:${String(msg.login ?? 'app-host')}` : `client:${String(msg.login ?? msg.invite)}`
        queueMicrotask(() =>
          msgListeners.forEach((cb) => cb(JSON.stringify({ t: 'peers', peer: { login: peer.login, pub: peerKey.publicKey } })))
        )
      } else if (msg.t === 'frame') {
        const key = deriveRelayKey(peerKey.privateKey, peerPub)
        const raw = openRelay(key, msg.env as never, runtimeSelfId)
        outbound.push({ to: String(msg.to), frame: parseRelayTermFrame(raw), raw })
      }
    },
    close: () => {},
    onMessage: (cb) => {
      msgListeners.push(cb)
    },
    onError: () => {},
    onClose: (cb) => {
      closeCb = cb
    }
  }

  function sealToRuntime(text: string): void {
    const key = deriveRelayKey(peerKey.privateKey, peerPub)
    const env = sealRelay(key, text, peerId)
    msgListeners.forEach((cb) => cb(JSON.stringify({ t: 'frame', from: peerId, env })))
  }

  return {
    factory: async () => sock,
    peerPub: peerKey.publicKey,
    deliver: (frame) => sealToRuntime(JSON.stringify(frame)),
    deliverRaw: (text) => sealToRuntime(text),
    outbound,
    fireClose: () => closeCb?.(),
    isClosed: () => closeCb !== null
  }
}

// A fake PtyHost over a per-term subscription map. onData returns an
// unsubscribe that records the call; push() feeds live output to subscribers.
function makePtyHost(termIds: string[] = ['term1']): PtyHost & {
  activeCount(id: string): number
  unsubIds: string[]
  writeCalls: Array<{ id: string; data: string }>
  resizeCalls: Array<{ id: string; cols: number; rows: number }>
  push(id: string, data: string): void
} {
  const subs = new Map<string, Set<(data: string) => void>>()
  const unsubIds: string[] = []
  const writeCalls: Array<{ id: string; data: string }> = []
  const resizeCalls: Array<{ id: string; cols: number; rows: number }> = []
  const host: PtyHost = {
    list: () => termIds.map((id, i) => ({ id, title: `T${i + 1}` })),
    onData: (id, cb) => {
      let set = subs.get(id)
      if (!set) {
        set = new Set()
        subs.set(id, set)
      }
      set.add(cb)
      return () => {
        set.delete(cb)
        unsubIds.push(id)
      }
    },
    write: (id, data) => writeCalls.push({ id, data }),
    resize: (id, cols, rows) => resizeCalls.push({ id, cols, rows })
  }
  return {
    ...host,
    activeCount: (id) => subs.get(id)?.size ?? 0,
    unsubIds,
    writeCalls,
    resizeCalls,
    push: (id, data) => subs.get(id)?.forEach((cb) => cb(data))
  }
}

function makeHostDeps(
  socketFactory: RelaySocketFactory,
  ptyHost: PtyHost,
  peerLogin = 'peer-one'
): RelayRuntimeDeps {
  return {
    resolveTarget: () => ({ url: 'ws://relay.test', role: 'host' as const }),
    broadcast: () => {},
    socketFactory,
    ptyHost,
    log: vi.fn()
  }
}

// Wait long enough for the coalescer's real timer (default 16ms) to flush.
const flushWait = () => new Promise((r) => setTimeout(r, 50))

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

describe('relay runtime host role', () => {
  const peerClient = { role: 'client' as const, login: 'peer-one' }

  it('list replies with a term-list JSON frame carrying ptyHost.list()', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['alpha', 'beta'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'list' })
    expect(harness.outbound).toHaveLength(1)
    expect(harness.outbound[0].to).toBe('client:peer-one')
    expect(harness.outbound[0].frame).toEqual({
      v: 1,
      k: 'term-list',
      terms: [
        { id: 'alpha', title: 'T1' },
        { id: 'beta', title: 'T2' }
      ]
    })
    harness.fireClose()
  })

  it('never forwards host-role inbound frames to the frameListener', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    const seen: Array<{ from: string; text: string }> = []
    rt.setFrameListener((f) => seen.push(f))
    harness.deliver({ v: 1, k: 'list' })
    harness.deliver({ v: 1, k: 'attach', term: 'term1' })
    expect(seen).toHaveLength(0)
    harness.fireClose()
  })

  it('attach subscribes onData and flushes pushed output as ONE out frame', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'attach', term: 'term1' })
    expect(ptyHost.activeCount('term1')).toBe(1)
    // Two chunks land inside the coalescer window → merged into a single frame.
    ptyHost.push('term1', 'hel')
    ptyHost.push('term1', 'lo')
    await flushWait()
    expect(harness.outbound).toHaveLength(1)
    expect(harness.outbound[0].to).toBe('client:peer-one')
    expect(harness.outbound[0].frame).toEqual({ v: 1, k: 'out', term: 'term1', data: 'hello' })
    harness.fireClose()
  })

  it('in writes through to ptyHost.write and resized calls ptyHost.resize', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'in', term: 'term1', data: 'ls -la\r' })
    harness.deliver({ v: 1, k: 'resized', term: 'term1', cols: 120, rows: 40 })
    expect(ptyHost.writeCalls).toEqual([{ id: 'term1', data: 'ls -la\r' }])
    expect(ptyHost.resizeCalls).toEqual([{ id: 'term1', cols: 120, rows: 40 }])
    harness.fireClose()
  })

  it('detach unsubscribes the term and stops further output', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'attach', term: 'term1' })
    expect(ptyHost.activeCount('term1')).toBe(1)
    harness.deliver({ v: 1, k: 'detach', term: 'term1' })
    expect(ptyHost.activeCount('term1')).toBe(0)
    expect(ptyHost.unsubIds).toEqual(['term1'])
    ptyHost.push('term1', 'ghost')
    await flushWait()
    expect(harness.outbound).toHaveLength(0)
    harness.fireClose()
  })

  it('double-attach is idempotent: the old subscription is unsubscribed first', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'attach', term: 'term1' })
    harness.deliver({ v: 1, k: 'attach', term: 'term1' })
    // Exactly one live subscription survives (the leaked first was removed).
    expect(ptyHost.activeCount('term1')).toBe(1)
    ptyHost.push('term1', 'once')
    await flushWait()
    // One subscription → one coalesced out frame, not two duplicates.
    expect(harness.outbound).toHaveLength(1)
    expect(harness.outbound[0].frame).toEqual({ v: 1, k: 'out', term: 'term1', data: 'once' })
    harness.fireClose()
  })

  it('attaching an unknown term id is ignored (fail open, no error to the peer)', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'attach', term: 'missing' })
    expect(ptyHost.activeCount('missing')).toBe(0)
    expect(ptyHost.activeCount('term1')).toBe(0)
    expect(harness.outbound).toHaveLength(0)
    harness.fireClose()
  })

  it('ignores inbound out/term-list frames and unparseable frames (fail open)', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliverRaw('not-json')
    harness.deliverRaw(JSON.stringify({ v: 1, k: 'bogus' }))
    harness.deliver({ v: 1, k: 'out', term: 'term1', data: 'x' })
    expect(harness.outbound).toHaveLength(0)
    harness.fireClose()
  })

  it('host role with no ptyHost ignores inbound frames entirely', async () => {
    const harness = makeHarness(peerClient)
    const rt = createRelayRuntime({
      resolveTarget: () => ({ url: 'ws://relay.test', role: 'host' as const }),
      broadcast: () => {},
      socketFactory: harness.factory,
      log: vi.fn()
    })
    await rt.connect()
    const seen: Array<{ from: string; text: string }> = []
    rt.setFrameListener((f) => seen.push(f))
    harness.deliver({ v: 1, k: 'list' })
    expect(seen).toHaveLength(0)
    expect(harness.outbound).toHaveLength(0)
    harness.fireClose()
  })

  it('client close unsubscribes every attached term and stops its coalescer', async () => {
    const harness = makeHarness(peerClient)
    const ptyHost = makePtyHost(['t1', 't2'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    harness.deliver({ v: 1, k: 'attach', term: 't1' })
    harness.deliver({ v: 1, k: 'attach', term: 't2' })
    expect(ptyHost.activeCount('t1')).toBe(1)
    expect(ptyHost.activeCount('t2')).toBe(1)
    harness.fireClose()
    expect(ptyHost.activeCount('t1')).toBe(0)
    expect(ptyHost.activeCount('t2')).toBe(0)
    expect(ptyHost.unsubIds.sort()).toEqual(['t1', 't2'])
    // Output after close must not be served.
    ptyHost.push('t1', 'late')
    await flushWait()
    expect(harness.outbound).toHaveLength(0)
  })
})

describe('relay runtime client role', () => {
  it('still forwards inbound frames to the frameListener as {from, text}', async () => {
    const harness = makeHarness({ role: 'host', login: 'h-host' })
    const rt = createRelayRuntime({
      resolveTarget: () => ({ url: 'ws://relay.test', role: 'client' as const, invite: 'INV' }),
      broadcast: () => {},
      socketFactory: harness.factory,
      log: vi.fn()
    })
    await rt.connect()
    const seen: Array<{ from: string; text: string }> = []
    rt.setFrameListener((f) => seen.push(f))
    harness.deliverRaw('hello-over-the-tunnel')
    expect(seen).toEqual([{ from: 'host:h-host', text: 'hello-over-the-tunnel' }])
    harness.fireClose()
  })

  it('sendTermFrame (paired client) seals an E2E envelope to host:<peerLogin>', async () => {
    const harness = makeHarness({ role: 'host', login: 'h-host' })
    const rt = createRelayRuntime({
      resolveTarget: () => ({ url: 'ws://relay.test', role: 'client' as const, invite: 'INV' }),
      broadcast: () => {},
      socketFactory: harness.factory,
      log: vi.fn()
    })
    await rt.connect()
    const res = rt.sendTermFrame({ v: 1, k: 'attach', term: 'term1' })
    expect(res).toEqual({ ok: true })
    // The outbound ws message routes to the paired host and round-trips back
    // to the exact relay-term frame (the harness opens it with the peer key).
    expect(harness.outbound).toHaveLength(1)
    expect(harness.outbound[0].to).toBe('host:h-host')
    expect(harness.outbound[0].frame).toEqual({ v: 1, k: 'attach', term: 'term1' })
    harness.fireClose()
  })

  it('sendTermFrame round-trips a client ' + "'in'" + ' frame the host can parse', async () => {
    const harness = makeHarness({ role: 'host', login: 'h-host' })
    const rt = createRelayRuntime({
      resolveTarget: () => ({ url: 'ws://relay.test', role: 'client' as const, invite: 'INV' }),
      broadcast: () => {},
      socketFactory: harness.factory,
      log: vi.fn()
    })
    await rt.connect()
    const res = rt.sendTermFrame({ v: 1, k: 'in', term: 'term1', data: 'ls -la\r' })
    expect(res.ok).toBe(true)
    expect(harness.outbound[0].to).toBe('host:h-host')
    // parseRelayTermFrame on the decrypted payload reproduces the sent frame.
    expect(parseRelayTermFrame(harness.outbound[0].raw)).toEqual({ v: 1, k: 'in', term: 'term1', data: 'ls -la\r' })
    harness.fireClose()
  })

  it('sendTermFrame returns ok:false when the app runs as host', async () => {
    const harness = makeHarness({ role: 'client', login: 'peer-one' })
    const ptyHost = makePtyHost(['term1'])
    const rt = createRelayRuntime(makeHostDeps(harness.factory, ptyHost))
    await rt.connect()
    const res = rt.sendTermFrame({ v: 1, k: 'list' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('host role')
    // A host never pushes its own requests upstream — nothing leaves.
    expect(harness.outbound).toHaveLength(0)
    harness.fireClose()
  })

  it('sendTermFrame returns ok:false when not paired (never connected)', async () => {
    const factory = fakeSocketFactory(() => {})
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://relay.test', role: 'client', invite: 'INV1' }))
    const res = rt.sendTermFrame({ v: 1, k: 'list' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('not paired')
  })
})
