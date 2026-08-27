// Phase 11 — Telegram pairing. TDD on the pure allowlist logic.
import { describe, it, expect } from 'vitest'
import { pairingDecision, addPairedChat } from './pairing'

describe('pairingDecision', () => {
  it('allows a chat already on the list', () => {
    expect(pairingDecision(42, ['42'])).toBe('allowed')
    expect(pairingDecision(42, ['7', '42', '9'])).toBe('allowed')
  })

  it('offers pairing to the FIRST chat when the list is empty', () => {
    expect(pairingDecision(42, [])).toBe('pair-me')
    expect(pairingDecision(7, [])).toBe('pair-me') // any chat can be the owner
  })

  it('denies a chat not on a non-empty list', () => {
    expect(pairingDecision(42, ['7'])).toBe('denied')
    expect(pairingDecision(42, ['7', '9'])).toBe('denied')
  })
})

describe('addPairedChat', () => {
  it('appends a new chat id', () => {
    expect(addPairedChat([], 42)).toEqual(['42'])
    expect(addPairedChat(['7'], 42)).toEqual(['7', '42'])
  })

  it('dedupes existing ids', () => {
    expect(addPairedChat(['42', '7'], 42)).toEqual(['42', '7'])
  })
})
