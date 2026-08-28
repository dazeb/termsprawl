// Phase 11 Task 11.2 — relay runtime wiring TDD. Fake socket factory; asserts
// state transitions + settings-driven target resolution + frame surfacing.
import { describe, it, expect, vi } from 'vitest'
import { createRelayRuntime, type RelayRuntimeDeps } from './relay'
import type { RelaySocket } from '../core/relay-client'

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

function makeDeps(factory: ReturnType<typeof fakeSocketFactory>, target: { url: string; role: 'host' | 'client'; invite?: string } | null): RelayRuntimeDeps & { events: Array<{ channel: string; payload: unknown }> } {
  const events: Array<{ channel: string; payload: unknown }> = []
  return {
    events,
    resolveTarget: () => target,
    broadcast: (channel, payload) => events.push({ channel, payload }),
    socketFactory: factory,
    log: vi.fn()
  }
}

describe('relay runtime', () => {
  it('connects, pairs, and reports state transitions', async () => {
    const factory = fakeSocketFactory((send) => {
      // respond to hello with a pairing ack (client role → filled peers frame)
      send(JSON.stringify({ t: 'peers', peer: { login: 'app-host', pub: 'PEER-PUB' } }))
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
      send(JSON.stringify({ t: 'peers', peer: { login: 'h', pub: 'PUB' } }))
    })
    const rt = createRelayRuntime(makeDeps(factory, { url: 'ws://r', role: 'client', invite: 'I' }))
    await rt.connect()
    rt.disconnect()
    expect(rt.state()).toBe('disconnected')
  })
})
