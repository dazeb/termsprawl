import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { WebSocket } from 'ws'

import { loadStore, saveStore, createInvite } from './store.mjs'
import { upsertUser } from './github-auth.mjs'
import { generateKeyPair } from './crypto.mjs'
import { createHub } from './hub.mjs'
import { createAdminHandler } from './admin.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')

const DEFAULTS = { users: [], invites: [] }

let dataDir, storeFile, store
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-admin-'))
  storeFile = path.join(dataDir, 'store.json')
  store = loadStore(storeFile, DEFAULTS)
})
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

/** Boot hub + admin on one ephemeral HTTP server; return a request helper. */
async function start({ adminToken = 'sekrit' } = {}) {
  const hub = createHub({ store, requireAuth: true, devAuth: true })
  const handler = createAdminHandler({ store, hub, adminToken })
  const server = http.createServer(handler)
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const req = async (method, p, { token, body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    let json = null
    try { json = await res.json() } catch { /* empty body */ }
    return { status: res.status, json }
  }
  const close = async () => {
    for (const c of hub.wss.clients) c.terminate()
    hub.wss.close()
    await new Promise((r) => server.close(r))
  }
  return { hub, server, base, req, close }
}

describe('GET /healthz', () => {
  it('returns 200 {ok:true} with no auth', async () => {
    const ctx = await start()
    try {
      const r = await ctx.req('GET', '/healthz')
      expect(r.status).toBe(200)
      expect(r.json).toEqual({ ok: true })
    } finally { await ctx.close() }
  })
})

describe('GET /admin/stats', () => {
  it('401 without a token', async () => {
    const ctx = await start()
    try {
      expect((await ctx.req('GET', '/admin/stats')).status).toBe(401)
      expect((await ctx.req('GET', '/admin/stats', { token: 'wrong' })).status).toBe(401)
    } finally { await ctx.close() }
  })

  it('200 with the bearer token; counters advance after hub traffic', async () => {
    const ctx = await start()
    try {
      createInvite(store, 'octo', { now: Date.now() })
      upsertUser(store, 'octo', 't')

      // some hub traffic (host stays connected while we read stats)
      const ws = new WebSocket(ctx.base.replace('http', 'ws') + '/')
      await new Promise((r) => ws.on('open', r))
      ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: 't', pub: generateKeyPair().publicKey }))
      await sleep(100)

      const r = await ctx.req('GET', '/admin/stats', { token: 'sekrit' })
      ws.close()
      expect(r.status).toBe(200)
      expect(r.json).toMatchObject({
        hosts: 1,
        clients: 0,
        framesRelayed: 0,
        invites: { active: 1 },
        users: 1,
        invitesTotal: 1
      })
    } finally { await ctx.close() }
  })
})

describe('POST /admin/invites/:code/revoke', () => {
  it('401 without a token', async () => {
    const ctx = await start()
    try {
      const inv = createInvite(store, 'octo', { now: Date.now() })
      expect((await ctx.req('POST', `/admin/invites/${inv.code}/revoke`)).status).toBe(401)
    } finally { await ctx.close() }
  })

  it('revokes an invite; hub redemption then fails with REVOKED', async () => {
    const ctx = await start()
    try {
      const inv = createInvite(store, 'octo', { now: Date.now() })
      const r = await ctx.req('POST', `/admin/invites/${inv.code}/revoke`, { token: 'sekrit' })
      expect(r.status).toBe(200)
      expect(r.json).toMatchObject({ ok: true, code: inv.code, revoked: true })
      expect(store.invites[0].revoked).toBe(true)

      // hub refuses the revoked invite
      const ws = new WebSocket(ctx.base.replace('http', 'ws') + '/')
      await new Promise((res) => ws.on('open', res))
      ws.send(JSON.stringify({ t: 'hello', role: 'client', invite: inv.code, pub: 'P' }))
      const reply = await new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))))
      expect(reply).toMatchObject({ t: 'error', code: 'REVOKED' })
      ws.close()
    } finally { await ctx.close() }
  })

  it('404 UNKNOWN for a nonexistent code', async () => {
    const ctx = await start()
    try {
      const r = await ctx.req('POST', '/admin/invites/nada1234/revoke', { token: 'sekrit' })
      expect(r.status).toBe(404)
      expect(r.json).toMatchObject({ error: 'UNKNOWN' })
    } finally { await ctx.close() }
  })
})

describe('DELETE /admin/users/:login', () => {
  it('401 without a token', async () => {
    const ctx = await start()
    try {
      expect((await ctx.req('DELETE', '/admin/users/octo')).status).toBe(401)
    } finally { await ctx.close() }
  })

  it('removes a user; their invites go with them', async () => {
    const ctx = await start()
    try {
      upsertUser(store, 'octo', 't')
      createInvite(store, 'octo', { now: Date.now() })
      createInvite(store, 'other', { now: Date.now() })

      const r = await ctx.req('DELETE', '/admin/users/octo', { token: 'sekrit' })
      expect(r.status).toBe(200)
      expect(r.json).toMatchObject({ ok: true, removed: 'octo' })
      expect(store.users.find((u) => u.login === 'octo')).toBeUndefined()
      expect(store.invites.find((i) => i.hostLogin === 'octo')).toBeUndefined()
      expect(store.invites.find((i) => i.hostLogin === 'other')).toBeDefined()

      // a second delete → 404
      expect((await ctx.req('DELETE', '/admin/users/octo', { token: 'sekrit' })).status).toBe(404)
    } finally { await ctx.close() }
  })
})

describe('unknown routes', () => {
  it('404 otherwise', async () => {
    const ctx = await start()
    try {
      expect((await ctx.req('GET', '/nope')).status).toBe(404)
      expect((await ctx.req('POST', '/admin/whatever', { token: 'sekrit' })).status).toBe(404)
    } finally { await ctx.close() }
  })
})

describe('index.mjs boot smoke (real child process)', () => {
  it('spawns `node relay/src/index.mjs`, serves /healthz, then shuts down', async () => {
    const port = 18790 + Math.floor(Math.random() * 500)
    const child = spawn(process.execPath, ['relay/src/index.mjs'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        RELAY_DATA_DIR: dataDir,
        RELAY_DEV_AUTH: '1',
        ADMIN_TOKEN: 'boot-token'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })

    try {
      // poll /healthz until the child is up (fail after ~5s)
      let healthy = false
      for (let i = 0; i < 50 && !healthy; i++) {
        await sleep(100)
        try {
          const res = await fetch(`http://127.0.0.1:${port}/healthz`)
          if (res.ok) {
            expect(await res.json()).toEqual({ ok: true })
            healthy = true
          }
        } catch { /* not listening yet */ }
      }
      expect(healthy).toBe(true)
      // admin route answers with the bearer token over the real server
      const stats = await fetch(`http://127.0.0.1:${port}/admin/stats`, {
        headers: { Authorization: 'Bearer boot-token' }
      })
      expect(stats.status).toBe(200)
      const body = await stats.json()
      expect(body).toMatchObject({ hosts: 0, clients: 0 })
      // ws upgrade works over the real composition too
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
      await new Promise((r) => ws.on('open', r))
      ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: '', pub: generateKeyPair().publicKey }))
      const reply = await new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))))
      expect(reply.t).toBe('peers')
      ws.close()
    } finally {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((r) => child.on('exit', r)),
        sleep(2000).then(() => child.kill('SIGKILL'))
      ])
    }
    expect(stderr).not.toMatch(/Error:/)
  }, 15000)
})
