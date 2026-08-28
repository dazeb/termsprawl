#!/usr/bin/env node
// termsprawl-relay composition root. Plain ESM, node builtins + ws only.
//
//   PORT             listen port          (default 8788)
//   RELAY_BIND       bind address         (default 127.0.0.1)
//   RELAY_DATA_DIR   store directory      (default ./data)
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET   OAuth device-flow app
//   ADMIN_TOKEN      bearer token for /admin/* (required unless RELAY_DEV_AUTH=1)
//   RELAY_DEV_AUTH   1 = unauthenticated dev hosts (refused under NODE_ENV=production)
//
// SECURITY: logs never contain frame or envelope contents — only ids, counts,
// and error codes. The relay never sees plaintext anyway, but it doesn't log
// ciphertext either.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

import { loadStore, saveStore } from './store.mjs'
import { createHub } from './hub.mjs'
import { createAdminHandler } from './admin.mjs'

const STORE_DEFAULTS = { users: [], invites: [] }

export function loadConfig(env = process.env) {
  const devAuth = env.RELAY_DEV_AUTH === '1'
  const config = {
    port: Number(env.PORT ?? 8788),
    bind: env.RELAY_BIND ?? '127.0.0.1',
    dataDir: env.RELAY_DATA_DIR ?? './data',
    githubClientId: env.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    adminToken: env.ADMIN_TOKEN ?? '',
    devAuth
  }
  if (devAuth && env.NODE_ENV === 'production') {
    console.error('[relay] RELAY_DEV_AUTH=1 is forbidden when NODE_ENV=production — refusing to start')
    process.exit(1)
  }
  if (!config.adminToken && !devAuth) {
    console.error('[relay] ADMIN_TOKEN is required unless RELAY_DEV_AUTH=1 — refusing to start')
    process.exit(1)
  }
  return config
}

export function startServer(config, log = console.log) {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const storeFile = path.join(config.dataDir, 'store.json')
  const store = loadStore(storeFile, STORE_DEFAULTS)

  const persist = () => saveStore(storeFile, store)
  const devAuth = config.devAuth
  const hub = createHub({ store, requireAuth: true, devAuth })

  // persist auth-mutating store changes (invite redemptions happen per hello)
  const origHandleUpgrade = hub.handleUpgrade
  hub.handleUpgrade = (req, socket, head) => {
    origHandleUpgrade.call(hub, req, socket, head)
    persist()
  }

  const handler = createAdminHandler({ store, hub, adminToken: config.adminToken })
  const server = http.createServer(handler)
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head))

  // metrics logger — counts only, never contents
  let lastFrames = 0
  const timer = setInterval(() => {
    const s = hub.stats()
    if (s.framesRelayed !== lastFrames) {
      lastFrames = s.framesRelayed
      log(`[relay] frames=${s.framesRelayed} bytes=${s.bytesRelayed} hosts=${s.hosts} clients=${s.clients} buffered=${s.buffered}`)
    }
  }, 10_000)
  timer.unref?.()

  return new Promise((resolve) => {
    server.listen(config.port, config.bind, () => {
      log(`[relay] listening on http://${config.bind}:${config.port} (devAuth=${devAuth ? 'on' : 'off'})`)
      log(`[relay] store=${storeFile}`)
      resolve({ server, hub, store, storeFile })
    })
  })
}

// run when invoked directly (not under test import)
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = loadConfig()
  startServer(config).catch((err) => {
    console.error('[relay] fatal:', err.message)
    process.exit(1)
  })
}
