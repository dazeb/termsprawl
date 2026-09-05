// Server Edition auth policy (audit B1). Pure + electron-free.
//
// Model: a 48-hex-char boot token. The WS upgrade path must present it as
// `Authorization: Bearer <token>` (or a `?token=` query param for shim
// reconnects). Comparison is timing-safe. No token configured + not explicitly
// disabled → refuse all connections (fail-closed).
//
// Explicit disclosure: setting TERMSPRAWL_SERVER_TOKEN='' (empty string, set
// on purpose) disables auth — for the localhost-only "I know what I'm doing"
// case. The absence of the env var does NOT disable auth; the boot path
// generates a token and prints it.
//
// Clean-room: written fresh for termsprawl.

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'

export interface AuthPolicy {
  readonly token: string
  /** True only when auth was EXPLICITLY disabled (empty token string). */
  readonly disabled: boolean
}

export function createAuthPolicy(explicitToken?: string): AuthPolicy {
  if (explicitToken === '') {
    // deliberate disclosure — caller must log a warning
    return { token: '', disabled: true }
  }
  const token = explicitToken && /^[0-9a-f]{48}$/.test(explicitToken)
    ? explicitToken
    : randomBytes(24).toString('hex')
  return { token, disabled: false }
}

/** Timing-safe token check. Accepts `Bearer <token>` or the bare token.
 * Never throws on malformed input. */
export function authorizeUpgrade(policy: AuthPolicy, authHeader?: string, urlToken?: string): boolean {
  if (policy.disabled) return true
  const presented = extractBearer(authHeader) ?? urlToken ?? ''
  if (presented.length === 0) return false
  return timingSafeCompare(presented, policy.token)
}

function extractBearer(header?: string): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : header.trim()
}

/** Constant-time equality over hashed values (so differing lengths don't
 * leak length information). Exported so the HTTP layer can reuse it to gate
 * /termsprawl-boot.js on the router-presented space header. */
export function timingSafeCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

/** Extract the token from an upgrade request (header or query param). */
export function tokenFromRequest(authHeader?: string, url?: string): { header?: string; urlToken?: string } {
  let urlToken: string | undefined
  if (url) {
    try {
      urlToken = new URL(url, 'http://x').searchParams.get('token') ?? undefined
    } catch {
      urlToken = undefined
    }
  }
  return { header: authHeader, urlToken }
}
