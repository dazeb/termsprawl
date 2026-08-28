// JSON file store with atomic writes + the invite model. Pure object logic;
// persistence is a single atomic rename so a crash mid-save never corrupts
// the previous on-disk state.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const INVITE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const DEFAULT_ACTIVE_INVITE_QUOTA = 5
export const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_INVITE_MAX_USES = 1

export class StoreError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

const fail = (code) => {
  throw new StoreError(code)
}

/** Fill in any default keys missing from a loaded store object (in place). */
function withDefaults(store, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (store[key] === undefined) store[key] = structuredClone(value)
  }
  return store
}

/**
 * Load a JSON store from disk. Missing file (or unparseable file) → defaults.
 */
export function loadStore(file, defaults) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return withDefaults(JSON.parse(raw), defaults)
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(defaults)
    if (err instanceof SyntaxError) return structuredClone(defaults)
    throw err
  }
}

/**
 * Atomic save: write to `${file}.tmp` then fs.renameSync into place. A crash
 * anywhere before the rename leaves the previous file completely intact.
 */
export function saveStore(file, data) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

/** Generate a crypto-random 8-char alphanumeric invite code. */
function newInviteCode() {
  const bytes = crypto.randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length]
  return code
}

/** True when an invite is redeemable right now: not expired, not revoked, uses < maxUses. */
export function isInviteActive(invite, now = Date.now()) {
  return (
    !invite.revoked && invite.expiresAt > now && invite.uses < invite.maxUses
  )
}

/** Count active invites for a host login at time `now`. */
export function countActiveInvites(store, hostLogin, now = Date.now()) {
  return store.invites.filter((inv) => inv.hostLogin === hostLogin && isInviteActive(inv, now)).length
}

/**
 * Mint a new invite for `hostLogin`. Enforces the per-host quota of ACTIVE
 * invites (not expired, not revoked, uses < maxUses). Throws StoreError
 * { code: 'QUOTA' } when the host is over quota.
 */
export function createInvite(store, hostLogin, { ttlMs = DEFAULT_INVITE_TTL_MS, maxUses = DEFAULT_INVITE_MAX_USES, now = Date.now(), quota = DEFAULT_ACTIVE_INVITE_QUOTA } = {}) {
  if (countActiveInvites(store, hostLogin, now) >= quota) fail('QUOTA')
  const invite = {
    code: newInviteCode(),
    hostLogin,
    expiresAt: now + ttlMs,
    maxUses,
    uses: 0,
    revoked: false
  }
  store.invites.push(invite)
  return invite
}

function findInvite(store, code) {
  return store.invites.find((inv) => inv.code === code)
}

/**
 * Redeem an invite by code. Typed errors: 'UNKNOWN' | 'EXPIRED' | 'REVOKED' |
 * 'EXHAUSTED'. Increments uses. Returns the invite.
 */
export function redeemInvite(store, code, now = Date.now()) {
  const invite = findInvite(store, code)
  if (!invite) fail('UNKNOWN')
  if (invite.revoked) fail('REVOKED')
  if (invite.expiresAt <= now) fail('EXPIRED')
  if (invite.uses >= invite.maxUses) fail('EXHAUSTED')
  invite.uses += 1
  return invite
}

/** Revoke an invite by code. Throws 'UNKNOWN' for a code that does not exist. */
export function revokeInvite(store, code) {
  const invite = findInvite(store, code)
  if (!invite) fail('UNKNOWN')
  invite.revoked = true
  return invite
}
