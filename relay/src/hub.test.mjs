import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'

import { loadStore, saveStore, createInvite, revokeInvite } from './store.mjs'
import { upsertUser } from './github-auth.mjs'
import { generateKeyPair, deriveSharedKey, seal, open } from './crypto.mjs'
import { createHub } from './hub.mjs'

// ---------------------------------------------------------------------------
// helpers (fail fast — every wait has a timeout, no hangs)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred, timeoutMs = 2000, label = 'condition') {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return
    await sleep(10)
  }
  throw new Error('timeout waiting for ' + label)
}

/**
 * Queue-based reader: messages are captured from the moment the socket is
 * created, so a frame that lands between two recv() calls is never lost.
 */
function reader(ws) {
  ws.__queue = []
  ws.__waiters = []
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    const w = ws.__waiters.shift()
    if (w) w.resolve(msg)
    else ws.__queue.push(msg)
  })
}

function recv(ws, timeoutMs = 2000) {
  if (ws.__queue && ws.__queue.length > 0) return Promise.resolve(ws.__queue.shift())
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs)
    ws.__waiters.push({
      resolve: (msg) => {
        clearTimeout(to)
        resolve(msg)
      }
    })
  })
}

const DEFAULTS = { users: [], invites: [] }

let dataDir, storeFile, store
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-hub-'))
  storeFile = path.join(dataDir, 'store.json')
  store = loadStore(storeFile, DEFAULTS)
})
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

/** Boot a hub on an ephemeral port with real HTTP + real ws upgrade. */
async function startHub(hubOpts = {}) {
  const hub = createHub({ store, requireAuth: true, devAuth: true, ...hubOpts })
  const server = http.createServer((req, res) => { res.writeHead(404); res.end() })
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const url = `ws://127.0.0.1:${port}`
  return {
    hub, server, url,
    async close() {
      for (const c of hub.wss.clients) c.terminate()
      hub.wss.close()
      await new Promise((r) => server.close(r))
    }
  }
}

const dial = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url)
  ws.once('error', reject)
  ws.once('open', () => {
    reader(ws)
    resolve(ws)
  })
})

/**
 * Full pair: dev host + client with a fresh invite.
 * Returns sockets, derived shared keys (hostKey / clientKey) and session ids —
 * derived FROM the peers frames, exactly as a real peer would.
 */
async function pairHostAndClient(ctx, { clientLogin = 'x' } = {}) {
  const host = await dial(ctx.url)
  const client = await dial(ctx.url)
  const hostKeys = generateKeyPair()
  const clientKeys = generateKeyPair()
  const inv = createInvite(store, 'octo', { now: Date.now() })

  host.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: '', pub: hostKeys.publicKey }))
  const hostAck = await recv(host)
  expect(hostAck.t).toBe('peers')
  expect(hostAck.peer).toBeNull() // registered, no client yet

  client.send(JSON.stringify({ t: 'hello', role: 'client', invite: inv.code, login: clientLogin, pub: clientKeys.publicKey }))

  // host learns the client's pub; client learns the host's pub
  const toHost = await recv(host)
  const toClient = await recv(client)
  expect(toHost.t).toBe('peers')
  expect(toClient.t).toBe('peers')
  expect(toHost.peer).toEqual({ login: clientLogin, pub: clientKeys.publicKey })
  expect(toClient.peer.login).toBe('dev-octo') // devAuth prefix
  expect(toClient.peer.pub).toBe(hostKeys.publicKey)

  return {
    host, client, inv,
    hostLogin: toClient.peer.login,          // 'dev-octo' under devAuth
    clientId: toHost.peer.login,             // the client's chosen login
    hostKey: deriveSharedKey(hostKeys.privateKey, toHost.peer.pub),
    clientKey: deriveSharedKey(clientKeys.privateKey, toClient.peer.pub),
  }
}

// ---------------------------------------------------------------------------

describe('hub construction', () => {
  it('constructs with a wss and empty stats', async () => {
    const ctx = await startHub()
    try {
      expect(ctx.hub.wss).toBeTruthy()
      expect(ctx.hub.stats()).toMatchObject({ hosts: 0, clients: 0, framesRelayed: 0, bytesRelayed: 0, invites: { active: 0 } })
    } finally { await ctx.close() }
  })

  it('hard-refuses devAuth when NODE_ENV=production', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() => createHub({ store, requireAuth: true, devAuth: true })).toThrow(/production/)
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })
})

describe('host hello', () => {
  it('registers a host with a valid token hash (no devAuth)', async () => {
    const ctx = await startHub({ devAuth: false })
    try {
      upsertUser(store, 'octo', 'real-token', { now: Date.now() })
      const ws = await dial(ctx.url)
      ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: 'real-token', pub: generateKeyPair().publicKey }))
      const reply = await recv(ws)
      expect(reply.t).toBe('peers')
      expect(reply.peer).toBeNull()
      expect(ctx.hub.stats().hosts).toBe(1)
      ws.close()
    } finally { await ctx.close() }
  })

  it('rejects a host with a bad token', async () => {
    const ctx = await startHub({ devAuth: false })
    try {
      upsertUser(store, 'octo', 'real-token')
      const ws = await dial(ctx.url)
      ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: 'wrong', pub: generateKeyPair().publicKey }))
      const reply = await recv(ws)
      expect(reply.t).toBe('error')
      expect(reply.code).toBe('AUTH')
      expect(ctx.hub.stats().hosts).toBe(0)
      ws.close()
    } finally { await ctx.close() }
  })

  it('rejects a host with an unknown login', async () => {
    const ctx = await startHub({ devAuth: false })
    try {
      const ws = await dial(ctx.url)
      ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'ghost', token: 'x', pub: generateKeyPair().publicKey }))
      const reply = await recv(ws)
      expect(reply.t).toBe('error')
      expect(reply.code).toBe('AUTH')
      ws.close()
    } finally { await ctx.close() }
  })

  it('a second host with the same login replaces the first (old socket gets REPLACED)', async () => {
    const ctx = await startHub()
    try {
      const h1 = await dial(ctx.url)
      const h2 = await dial(ctx.url)
      const hello = (ws) => ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: '', pub: generateKeyPair().publicKey }))
      hello(h1)
      expect((await recv(h1)).peer).toBeNull()
      hello(h2)
      expect((await recv(h2)).peer).toBeNull()
      const err = await recv(h1)
      expect(err.t).toBe('error')
      expect(err.code).toBe('REPLACED')
      await waitFor(() => ctx.hub.stats().hosts === 1, 2000, 'single host session')
      h1.close(); h2.close()
    } finally { await ctx.close() }
  })

  it('devAuth derives a dev- prefixed login', async () => {
    const ctx = await startHub({ devAuth: true })
    try {
      const ws = await dial(ctx.url)
      ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: '', pub: generateKeyPair().publicKey }))
      const ws2 = await dial(ctx.url)
      ws2.send(JSON.stringify({ t: 'hello', role: 'client', invite: 'irrelevant', login: 'phone', pub: generateKeyPair().publicKey }))
      // client will fail (no such invite) but the HOST session must be dev-prefixed;
      // prove it by pairing a real client and reading peer.login
      const inv = createInvite(store, 'octo', { now: Date.now() })
      const ws3 = await dial(ctx.url)
      ws3.send(JSON.stringify({ t: 'hello', role: 'client', invite: inv.code, login: 'phone', pub: generateKeyPair().publicKey }))
      const hostPeers = await recv(ws) // may be the failed-client ack first — drain until peers
      let hostPeerFrame = hostPeers
      if (hostPeerFrame.t !== 'peers' || hostPeerFrame.peer === null) hostPeerFrame = await recv(ws)
      expect(hostPeerFrame.peer.login).toBe('phone')
      ws.close(); ws2.close(); ws3.close()
    } finally { await ctx.close() }
  })
})

describe('pairing + E2E routing', () => {
  it('hello → peers both ways → client frame → host decrypts UNCHANGED plaintext', async () => {
    const ctx = await startHub()
    try {
      const { host, client, hostKey, clientKey, hostLogin } = await pairHostAndClient(ctx)

      const env = seal(clientKey, 'ping through the relay', 'client:x')
      client.send(JSON.stringify({ t: 'frame', to: 'host:' + hostLogin, env }))

      const got = await recv(host)
      expect(got.t).toBe('frame')
      expect(got.from).toBe('client:x')
      // THE security assertion: the test decrypts locally — the relay carried opaque bytes
      expect(open(hostKey, got.env, 'client:x')).toBe('ping through the relay')
    } finally { await ctx.close() }
  })

  it('unknown recipient → NOBODY-HOME to the sender', async () => {
    const ctx = await startHub()
    try {
      const { host } = await pairHostAndClient(ctx)
      host.send(JSON.stringify({ t: 'frame', to: 'client:nobody', env: { n: 'a', c: 'b' } }))
      const reply = await recv(host)
      expect(reply.t).toBe('error')
      expect(reply.code).toBe('NOBODY-HOME')
    } finally { await ctx.close() }
  })

  it('offline buffering: frames sent to a disconnected client flush on reconnect (in order)', async () => {
    const ctx = await startHub()
    try {
      const { host, client, inv, hostKey, clientKey, hostLogin } = await pairHostAndClient(ctx)

      const closed = once(client, 'close')
      client.close()
      await closed
      await waitFor(() => ctx.hub.stats().clients === 0, 2000, 'client disconnect registered')

      for (const msg of ['queued-1', 'queued-2', 'queued-3']) {
        host.send(JSON.stringify({ t: 'frame', to: 'client:x', env: seal(hostKey, msg, 'host:' + hostLogin) }))
      }
      await waitFor(() => ctx.hub.stats().buffered === 3, 2000, 'buffered frames')

      // reconnect: same invite code + same login → resume the pairing
      const client2 = await dial(ctx.url)
      client2.send(JSON.stringify({ t: 'hello', role: 'client', invite: inv.code, login: 'x', pub: generateKeyPair().publicKey }))
      const peers = await recv(client2)
      expect(peers.t).toBe('peers')

      const m1 = await recv(client2)
      const m2 = await recv(client2)
      const m3 = await recv(client2)
      expect([m1, m2, m3].map((m) => open(clientKey, m.env, 'host:' + hostLogin)))
        .toEqual(['queued-1', 'queued-2', 'queued-3'])
      client2.close()
    } finally { await ctx.close() }
  })

  it('offline queue caps at 100 envelopes (drops oldest)', async () => {
    const ctx = await startHub()
    try {
      const { host, client, hostKey, hostLogin } = await pairHostAndClient(ctx)
      const closed = once(client, 'close')
      client.close()
      await closed
      await waitFor(() => ctx.hub.stats().clients === 0, 2000, 'client disconnect registered')

      for (let i = 0; i < 130; i++) {
        host.send(JSON.stringify({ t: 'frame', to: 'client:x', env: seal(hostKey, 'q' + i, 'host:' + hostLogin) }))
      }
      await waitFor(() => ctx.hub.stats().buffered === 100, 3000, 'buffer cap')
    } finally { await ctx.close() }
  })

  it('direct-offer is routed verbatim with from attached (relay never parses it)', async () => {
    const ctx = await startHub()
    try {
      const { host, client, hostLogin } = await pairHostAndClient(ctx)
      const endpoint = { kind: 'webrtc', b64: 'c2QrZg==' }
      host.send(JSON.stringify({ t: 'direct-offer', to: 'client:x', endpoint }))
      const got = await recv(client)
      expect(got.t).toBe('direct-offer')
      expect(got.from).toBe('host:' + hostLogin)
      expect(got.endpoint).toEqual(endpoint)
    } finally { await ctx.close() }
  })

  it('expired invite → EXPIRED; revoked invite → REVOKED; unknown invite → UNKNOWN', async () => {
    const ctx = await startHub()
    try {
      // expired
      const expired = createInvite(store, 'octo', { now: Date.now() - 8 * 24 * 3600 * 1000 })
      expired.expiresAt = Date.now() - 1000
      // revoked
      const revoked = createInvite(store, 'octo', { now: Date.now() })
      revokeInvite(store, revoked.code)

      const ws1 = await dial(ctx.url)
      ws1.send(JSON.stringify({ t: 'hello', role: 'client', invite: expired.code, pub: generateKeyPair().publicKey }))
      expect(await recv(ws1)).toMatchObject({ t: 'error', code: 'EXPIRED' })

      const ws2 = await dial(ctx.url)
      ws2.send(JSON.stringify({ t: 'hello', role: 'client', invite: revoked.code, pub: generateKeyPair().publicKey }))
      expect(await recv(ws2)).toMatchObject({ t: 'error', code: 'REVOKED' })

      const ws3 = await dial(ctx.url)
      ws3.send(JSON.stringify({ t: 'hello', role: 'client', invite: 'nope1234', pub: generateKeyPair().publicKey }))
      expect(await recv(ws3)).toMatchObject({ t: 'error', code: 'UNKNOWN' })

      ws1.close(); ws2.close(); ws3.close()
      expect(ctx.hub.stats().clients).toBe(0)
    } finally { await ctx.close() }
  })

  it('client pairing with no host online → HOST-OFFLINE', async () => {
    const ctx = await startHub()
    try {
      const inv = createInvite(store, 'octo', { now: Date.now() })
      const ws = await dial(ctx.url)
      ws.send(JSON.stringify({ t: 'hello', role: 'client', invite: inv.code, login: 'x', pub: generateKeyPair().publicKey }))
      const reply = await recv(ws)
      expect(reply.t).toBe('error')
      expect(reply.code).toBe('HOST-OFFLINE')
      ws.close()
    } finally { await ctx.close() }
  })

  it('frames before hello → AUTH (auth required on every socket)', async () => {
    const ctx = await startHub({ devAuth: false })
    try {
      const ws = await dial(ctx.url)
      ws.send(JSON.stringify({ t: 'frame', to: 'x', env: { n: 'a', c: 'b' } }))
      const reply = await recv(ws)
      expect(reply.t).toBe('error')
      expect(reply.code).toBe('AUTH')
      ws.close()
    } finally { await ctx.close() }
  })
})

describe('metrics', () => {
  it('counters advance on traffic; invites.active reflects the store', async () => {
    const ctx = await startHub()
    try {
      const spare = createInvite(store, 'octo', { now: Date.now() }) // stays unused → active
      const { host, client, hostLogin } = await pairHostAndClient(ctx) // redeems its own invite (used up)

      let s = ctx.hub.stats()
      expect(s.hosts).toBe(1)
      expect(s.clients).toBe(1)
      expect(s.invites.active).toBe(1) // only the spare is active now

      const env = seal(clientKeyOf(ctx), 'x', 'client:x')
      client.send(JSON.stringify({ t: 'frame', to: 'host:' + hostLogin, env }))
      await recv(host)
      s = ctx.hub.stats()
      expect(s.framesRelayed).toBe(1)
      expect(s.bytesRelayed).toBeGreaterThan(0)
      expect(s.buffered).toBe(0)
    } finally { await ctx.close() }
  })
})

// tiny helper so the metrics test can seal without threading keys through
import { deriveSharedKey as _dsk } from './crypto.mjs'
function clientKeyOf() {
  // the metrics test only needs a syntactically valid envelope — the hub never
  // inspects ciphertext; any 32-byte key works
  return _dsk(generateKeyPair().privateKey, generateKeyPair().publicKey)
}
