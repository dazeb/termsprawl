import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'

import { loadConfig, startServer } from './index.mjs'

function reader(ws) {
  const queue = []
  const waiters = []
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    const waiter = waiters.shift()
    if (waiter) waiter(msg)
    else queue.push(msg)
  })
  return () => queue.length
    ? Promise.resolve(queue.shift())
    : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for relay message')), 2000)
        waiters.push((msg) => { clearTimeout(timer); resolve(msg) })
      })
}

async function dial(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return { ws, recv: reader(ws) }
}

describe('relay security regressions', () => {
  it('rejects dev auth on a non-loopback bind regardless of NODE_ENV', () => {
    expect(() => loadConfig({ RELAY_DEV_AUTH: '1', RELAY_BIND: '0.0.0.0' })).toThrow(/loopback/i)
    expect(() => loadConfig({ RELAY_DEV_AUTH: '1', RELAY_BIND: '192.168.1.10' })).toThrow(/loopback/i)
    expect(() => loadConfig({ RELAY_DEV_AUTH: '1', RELAY_BIND: '127.0.0.1' })).not.toThrow()
  })

  it('persists invite creation and redemption before acknowledging them', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-security-'))
    const ctx = await startServer({
      port: 0,
      bind: '127.0.0.1',
      dataDir,
      githubClientId: '',
      githubClientSecret: '',
      adminToken: '',
      devAuth: true
    }, () => {})

    try {
      const port = ctx.server.address().port
      const url = `ws://127.0.0.1:${port}`
      const host = await dial(url)
      host.ws.send(JSON.stringify({ t: 'hello', role: 'host', login: 'octo', token: '', pub: 'host-pub' }))
      expect((await host.recv()).t).toBe('peers')

      host.ws.send(JSON.stringify({ t: 'invite-create' }))
      const inviteReply = await host.recv()
      expect(inviteReply.t).toBe('invite')

      const afterCreate = JSON.parse(fs.readFileSync(ctx.storeFile, 'utf8'))
      const created = afterCreate.invites.find((inv) => inv.code === inviteReply.code)
      expect(created).toBeTruthy()
      expect(created.uses).toBe(0)

      const client = await dial(url)
      client.ws.send(JSON.stringify({
        t: 'hello', role: 'client', invite: inviteReply.code, login: 'phone', pub: 'client-pub'
      }))
      expect((await client.recv()).t).toBe('peers')

      const afterRedeem = JSON.parse(fs.readFileSync(ctx.storeFile, 'utf8'))
      const redeemed = afterRedeem.invites.find((inv) => inv.code === inviteReply.code)
      expect(redeemed.uses).toBe(1)

      host.ws.close()
      client.ws.close()
    } finally {
      for (const client of ctx.hub.wss.clients) client.terminate()
      ctx.hub.wss.close()
      await new Promise((resolve) => ctx.server.close(resolve))
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
