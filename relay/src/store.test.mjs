import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  loadStore,
  saveStore,
  createInvite,
  redeemInvite,
  revokeInvite,
  countActiveInvites
} from './store.mjs'


// Capture the typed error code from a throwing function (or null when it doesn't throw).
const errCode = (fn) => {
  try {
    fn()
    return null
  } catch (err) {
    return err.code ?? null
  }
}

const DEFAULTS = { users: [], invites: [] }

let dir
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-store-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const file = () => path.join(dir, 'store.json')

describe('atomic JSON store', () => {
  it('returns defaults when the file does not exist', () => {
    const store = loadStore(file(), DEFAULTS)
    expect(store).toEqual(DEFAULTS)
  })

  it('round-trips data through save + load', () => {
    const f = file()
    saveStore(f, { users: [{ login: 'octo' }], invites: [] })
    const store = loadStore(f, DEFAULTS)
    expect(store.users).toEqual([{ login: 'octo' }])
    expect(store.invites).toEqual([])
  })

  it('fills in missing default keys on load', () => {
    const f = file()
    saveStore(f, { users: [{ login: 'octo' }] })
    const store = loadStore(f, DEFAULTS)
    expect(store.users).toEqual([{ login: 'octo' }])
    expect(store.invites).toEqual([])
  })

  it('a crash mid-save leaves the old file intact (renameSync throws)', () => {
    const f = file()
    saveStore(f, { users: [{ login: 'good' }], invites: [] })
    const original = fs.renameSync
    fs.renameSync = () => {
      throw new Error('simulated crash mid-rename')
    }
    try {
      expect(() =>
        saveStore(f, { users: [{ login: 'bad' }], invites: [] })
      ).toThrow(/simulated crash/)
    } finally {
      fs.renameSync = original
    }
    // the previous on-disk state survived untouched
    expect(loadStore(f, DEFAULTS).users).toEqual([{ login: 'good' }])
  })

  it('a crash mid-write leaves the old file intact (writeFileSync throws)', () => {
    const f = file()
    saveStore(f, { users: [{ login: 'good' }], invites: [] })
    const original = fs.writeFileSync
    fs.writeFileSync = () => {
      throw new Error('simulated crash mid-write')
    }
    try {
      expect(() => saveStore(f, { users: [{ login: 'bad' }], invites: [] })).toThrow(
        /simulated crash/
      )
    } finally {
      fs.writeFileSync = original
    }
    expect(loadStore(f, DEFAULTS).users).toEqual([{ login: 'good' }])
  })

  it('save creates parent directories', () => {
    const nested = path.join(dir, 'a', 'b', 'store.json')
    saveStore(nested, DEFAULTS)
    expect(loadStore(nested, DEFAULTS)).toEqual(DEFAULTS)
  })
})

describe('invites', () => {
  const NOW = 1_000_000_000_000

  it('creates an 8-char single-use invite with a 7-day TTL by default', () => {
    const store = { users: [], invites: [] }
    const inv = createInvite(store, 'octo', { now: NOW })
    expect(inv.code).toMatch(/^[0-9a-zA-Z]{8}$/)
    expect(inv.hostLogin).toBe('octo')
    expect(inv.expiresAt).toBe(NOW + 7 * 24 * 60 * 60 * 1000)
    expect(inv.maxUses).toBe(1)
    expect(inv.uses).toBe(0)
    expect(inv.revoked).toBe(false)
    expect(store.invites).toHaveLength(1)
  })

  it('honours custom ttl/maxUses and produces unique codes', () => {
    const store = { users: [], invites: [] }
    const a = createInvite(store, 'octo', { now: NOW, ttlMs: 1000, maxUses: 3 })
    const b = createInvite(store, 'octo', { now: NOW, ttlMs: 1000, maxUses: 3 })
    expect(a.expiresAt).toBe(NOW + 1000)
    expect(b.maxUses).toBe(3)
    expect(a.code).not.toBe(b.code)
  })

  it('enforces the per-host active invite quota (default 5)', () => {
    const store = { users: [], invites: [] }
    for (let i = 0; i < 5; i++) createInvite(store, 'octo', { now: NOW })
    expect(errCode(() => createInvite(store, 'octo', { now: NOW }))).toBe('QUOTA')
    // other hosts are unaffected
    expect(() => createInvite(store, 'other', { now: NOW })).not.toThrow()
  })

  it('expired / revoked / exhausted invites do not count toward quota', () => {
    const store = { users: [], invites: [] }
    for (let i = 0; i < 5; i++) createInvite(store, 'octo', { now: NOW })
    store.invites[0].revoked = true // 4 active
    createInvite(store, 'octo', { now: NOW })
    store.invites[1].expiresAt = NOW - 1 // 4 active again
    createInvite(store, 'octo', { now: NOW })
    store.invites[2].uses = store.invites[2].maxUses // 4 active again
    expect(() => createInvite(store, 'octo', { now: NOW })).not.toThrow()
    expect(countActiveInvites(store, 'octo', NOW)).toBe(5)
  })

  it('redeems an invite and increments uses', () => {
    const store = { users: [], invites: [] }
    const inv = createInvite(store, 'octo', { now: NOW })
    const got = redeemInvite(store, inv.code, NOW + 5)
    expect(got.code).toBe(inv.code)
    expect(got.uses).toBe(1)
  })

  it('rejects unknown codes', () => {
    const store = { users: [], invites: [] }
    expect(errCode(() => redeemInvite(store, 'nada1234', NOW))).toBe('UNKNOWN')
  })

  it('rejects expired invites', () => {
    const store = { users: [], invites: [] }
    const inv = createInvite(store, 'octo', { now: NOW, ttlMs: 100 })
    expect(errCode(() => redeemInvite(store, inv.code, NOW + 101))).toBe('EXPIRED')
  })

  it('rejects revoked invites', () => {
    const store = { users: [], invites: [] }
    const inv = createInvite(store, 'octo', { now: NOW })
    revokeInvite(store, inv.code)
    expect(errCode(() => redeemInvite(store, inv.code, NOW + 1))).toBe('REVOKED')
  })

  it('rejects exhausted invites (second use of a single-use code)', () => {
    const store = { users: [], invites: [] }
    const inv = createInvite(store, 'octo', { now: NOW })
    redeemInvite(store, inv.code, NOW + 1)
    expect(errCode(() => redeemInvite(store, inv.code, NOW + 2))).toBe('EXHAUSTED')
  })

  it('a maxUses=3 invite works until the third redemption', () => {
    const store = { users: [], invites: [] }
    const inv = createInvite(store, 'octo', { now: NOW, maxUses: 3 })
    redeemInvite(store, inv.code, NOW + 1)
    redeemInvite(store, inv.code, NOW + 2)
    expect(redeemInvite(store, inv.code, NOW + 3).uses).toBe(3)
    expect(errCode(() => redeemInvite(store, inv.code, NOW + 4))).toBe('EXHAUSTED')
  })

  it('revocation persists via save/load', () => {
    const f = file()
    const store = loadStore(f, DEFAULTS)
    const inv = createInvite(store, 'octo', { now: NOW })
    revokeInvite(store, inv.code)
    saveStore(f, store)
    const reloaded = loadStore(f, DEFAULTS)
    expect(errCode(() => redeemInvite(reloaded, inv.code, NOW + 1))).toBe('REVOKED')
  })

  it('revoking an unknown code throws UNKNOWN', () => {
    const store = { users: [], invites: [] }
    expect(errCode(() => revokeInvite(store, 'zzzzzzzz'))).toBe('UNKNOWN')
  })
})
