// Pure, electron-free SearXNG sidecar configuration (Phase 14). Generates the
// settings.yml the vendored searxng instance boots with, plus the port/secret
// plumbing. Kept in src/core so the Server Edition could share it later.
//
// Hardened shape: loopback-only bind, random high port, generated secret key,
// built-in limiter backed by sqlite (no redis), JSON output enabled for the
// agent search API.

import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'

export const SEARXNG_PORT_RANGE = { min: 49152, max: 65535 } as const

export const SEARXNG_SECRET_LENGTH = 64

/** Generate a settings.yml for the vendored searxng instance. */
export function generateSearxngSettings(port: number, secretKey: string): string {
  if (!Number.isInteger(port) || port < SEARXNG_PORT_RANGE.min || port > SEARXNG_PORT_RANGE.max) {
    throw new Error(`searxng port must be within ${SEARXNG_PORT_RANGE.min}-${SEARXNG_PORT_RANGE.max}`)
  }
  if (secretKey.length < 32) {
    throw new Error('searxng secret key must be at least 32 characters')
  }
  return `use_default_settings: true
server:
  bind_address: 127.0.0.1
  port: ${port}
  secret_key: "${secretKey}"
  limiter: true
  public_instance: false
search:
  formats:
    - html
    - json
redis:
  url: false
`
}

/** A fresh random hex secret key (64 hex chars = 32 bytes). */
export function generateSecretKey(): string {
  return randomBytes(SEARXNG_SECRET_LENGTH / 2).toString('hex')
}

/** Pick a free port in the app's loopback service range (repo convention).
 * The OS ephemeral range can sit below 49152 (Linux default 32768-60999), so
 * listen(0) isn't guaranteed to land inside it — probe explicit random high
 * ports instead, retrying on conflict. */
export async function pickFreePort(): Promise<number> {
  const span = SEARXNG_PORT_RANGE.max - SEARXNG_PORT_RANGE.min + 1
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = SEARXNG_PORT_RANGE.min + Math.floor(Math.random() * span)
    const free = await new Promise<boolean>((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error('could not pick a free port in the searxng range')
}

/** Health-check URL for the sidecar on the given port. */
export function searxngHealthUrl(port: number): string {
  return `http://127.0.0.1:${port}/healthz`
}
