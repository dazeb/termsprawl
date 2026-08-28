import { describe, it, expect } from 'vitest'

import { generateKeyPair, deriveSharedKey, seal, open } from './crypto.mjs'

describe('X25519 key pairs', () => {
  it('generates raw base64 public/private keys', () => {
    const a = generateKeyPair()
    expect(typeof a.publicKey).toBe('string')
    expect(typeof a.privateKey).toBe('string')
    // raw x25519 public key = 32 bytes, private key = 32 bytes
    expect(Buffer.from(a.publicKey, 'base64').length).toBe(32)
    expect(Buffer.from(a.privateKey, 'base64').length).toBe(32)
    const b = generateKeyPair()
    expect(a.publicKey).not.toBe(b.publicKey)
    expect(a.privateKey).not.toBe(b.privateKey)
  })
})

describe('shared key derivation', () => {
  it('both sides derive the same 32-byte key', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const k1 = deriveSharedKey(a.privateKey, b.publicKey)
    const k2 = deriveSharedKey(b.privateKey, a.publicKey)
    expect(k1).toEqual(k2)
    expect(k1.length).toBe(32)
  })

  it('different peers derive different keys', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const c = generateKeyPair()
    expect(deriveSharedKey(a.privateKey, b.publicKey)).not.toEqual(deriveSharedKey(a.privateKey, c.publicKey))
  })

  it('rejects malformed keys', () => {
    const a = generateKeyPair()
    expect(() => deriveSharedKey(a.privateKey, 'not-base64!!!')).toThrow()
    expect(() => deriveSharedKey('junk', a.publicKey)).toThrow()
  })
})

describe('seal/open round-trip', () => {
  it('seals to {n,c} and opens back to the exact plaintext', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const key = deriveSharedKey(a.privateKey, b.publicKey)
    const sealed = seal(key, 'hello relay', 'client:1')
    expect(Object.keys(sealed).sort()).toEqual(['c', 'n'])
    expect(sealed.n).not.toBe(sealed.c)
    const plaintext = open(key, sealed, 'client:1')
    expect(plaintext).toBe('hello relay')
  })

  it('handles unicode and empty strings', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const key = deriveSharedKey(a.privateKey, b.publicKey)
    expect(open(key, seal(key, 'héllo 🌊', 'h'), 'h')).toBe('héllo 🌊')
    expect(open(key, seal(key, '', 'h'), 'h')).toBe('')
  })

  it('tampered ciphertext throws', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const key = deriveSharedKey(a.privateKey, b.publicKey)
    const sealed = seal(key, 'secret', 'h')
    const cBytes = Buffer.from(sealed.c, 'base64')
    cBytes[0] ^= 0x01
    const tampered = { ...sealed, c: cBytes.toString('base64') }
    expect(() => open(key, tampered, 'h')).toThrow()
  })

  it('tampered auth tag throws', () => {
    const key = deriveSharedKey(generateKeyPair().privateKey, generateKeyPair().publicKey)
    const sealed = seal(key, 'secret', 'h')
    const cBytes = Buffer.from(sealed.c, 'base64')
    cBytes[cBytes.length - 1] ^= 0xff // last 16 bytes are the GCM tag
    expect(() => open(key, { ...sealed, c: cBytes.toString('base64') }, 'h')).toThrow()
  })

  it('the wrong key (different peer) throws', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const eve = generateKeyPair()
    const keyAB = deriveSharedKey(a.privateKey, b.publicKey)
    const keyEve = deriveSharedKey(eve.privateKey, a.publicKey) // eavesdropper's key
    const sealed = seal(keyAB, 'secret', 'h')
    expect(() => open(keyEve, sealed, 'h')).toThrow()
  })

  it('binds the sender id — opening with the wrong fromId throws', () => {
    const key = deriveSharedKey(generateKeyPair().privateKey, generateKeyPair().publicKey)
    const sealed = seal(key, 'secret', 'client:1')
    expect(() => open(key, sealed, 'client:2')).toThrow()
  })

  it('1000 seals all have unique nonces', () => {
    const key = crypto.randomBytes(32) // any 32-byte key works for sealing
    const nonces = new Set()
    for (let i = 0; i < 1000; i++) {
      const { n } = seal(key, 'msg ' + i, 'x')
      nonces.add(n)
    }
    expect(nonces.size).toBe(1000)
  })

  it('rejects a truncated/invalid envelope', () => {
    const key = crypto.randomBytes(32)
    expect(() => open(key, { n: '!!!', c: '!!!' }, 'x')).toThrow()
    expect(() => open(key, {}, 'x')).toThrow()
  })
})

import crypto from 'node:crypto'
