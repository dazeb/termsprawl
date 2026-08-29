import { describe, expect, it } from 'vitest'
import { isResizeObserverNoise } from './ro-noise'

describe('isResizeObserverNoise', () => {
  it('matches both Chromium spellings', () => {
    expect(isResizeObserverNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true)
    expect(isResizeObserverNoise('ResizeObserver loop limit exceeded')).toBe(true)
  })

  it('matches with trailing detail appended (prefix match)', () => {
    expect(
      isResizeObserverNoise('ResizeObserver loop completed with undelivered notifications. at Object.foo (x.ts:1:1)')
    ).toBe(true)
  })

  it('rejects real errors and non-strings', () => {
    expect(isResizeObserverNoise('TypeError: Cannot read properties of undefined')).toBe(false)
    expect(isResizeObserverNoise('resizeobserver loop completed')).toBe(false) // case-sensitive
    expect(isResizeObserverNoise(undefined)).toBe(false)
    expect(isResizeObserverNoise(null)).toBe(false)
    expect(isResizeObserverNoise(42)).toBe(false)
  })
})
