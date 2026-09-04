// relay-trust.test.ts — the Settings → Relay pairing-trust decision (A4).
// Pure function, so it needs no browser or window.termsprawl mock.
import { describe, it, expect } from 'vitest'
import { trustState } from './relay-trust'

const FP = 'ab12 cd34 ef56 7890 1234 5678 90ab cdef'

describe('trustState', () => {
  it('shows no card when a connect has no peer fingerprint (not yet paired)', () => {
    expect(trustState(undefined, null)).toBe('none')
    // A previously trusted key does not resurrect a card-less fingerprint.
    expect(trustState(FP, null)).toBe('none')
  })

  it('asks to confirm on the first pairing', () => {
    expect(trustState(undefined, FP)).toBe('confirm')
  })

  it('trusts silently when the fingerprint matches the persisted trust', () => {
    expect(trustState(FP, FP)).toBe('trusted')
  })

  it('warns hard when the key changed from the persisted fingerprint', () => {
    expect(trustState(FP, '9999 8888 7777 6666 5555 4444 3333 2222')).toBe('mismatch')
  })
})
