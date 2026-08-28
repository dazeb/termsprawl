// Phase 11 Task 11.4 — chat driver v2 core: cost meter TDD.
import { describe, it, expect } from 'vitest'
import { DEFAULT_PRICES, priceFor, costOf, conversationCost, type ModelPrice } from './cost'

describe('priceFor', () => {
  it('picks the LONGEST matching prefix', () => {
    expect(priceFor('gpt-4o-2024-08-06')).toEqual({ in: 2.5, out: 10 })
    expect(priceFor('gpt-4o')).toEqual({ in: 2.5, out: 10 })
    expect(priceFor('gpt-4.1-mini')).toEqual({ in: 0.5, out: 1.5 })
    expect(priceFor('claude-3-5-haiku-20241022')).toEqual({ in: 0.8, out: 4 })
    expect(priceFor('claude-sonnet-4-5')).toEqual({ in: 3, out: 15 })
  })

  it('returns null for unknown models', () => {
    expect(priceFor('llama-9000')).toBeNull()
  })

  it('user overrides win (exact then prefix)', () => {
    const overrides: Record<string, ModelPrice> = {
      'gpt-4o': { in: 1, out: 2 },
      'my-': { in: 0.1, out: 0.2 }
    }
    expect(priceFor('gpt-4o', overrides)).toEqual({ in: 1, out: 2 })
    expect(priceFor('my-model', overrides)).toEqual({ in: 0.1, out: 0.2 })
    // non-matching overrides fall through to defaults
    expect(priceFor('claude-3-opus', overrides)).toEqual({ in: 3, out: 15 })
  })
})

describe('costOf', () => {
  it('computes exact USD for a known model', () => {
    // gpt-4o: in $2.5/Mtok, out $10/Mtok
    const c = costOf({ inputTokens: 2, outputTokens: 3 }, 'gpt-4o')
    expect(c.estimated).toBe(false)
    expect(c.usd).toBeCloseTo((2 * 2.5 + 3 * 10) / 1e6, 15)
  })

  it('marks unknown models estimated with usd 0', () => {
    const c = costOf({ inputTokens: 1000, outputTokens: 1000 }, 'mystery-model')
    expect(c).toEqual({ usd: 0, estimated: true })
  })

  it('honors overrides in costOf', () => {
    const c = costOf({ inputTokens: 1_000_000, outputTokens: 0 }, 'x-model', { 'x-': { in: 2, out: 4 } })
    expect(c.usd).toBe(2)
    expect(c.estimated).toBe(false)
  })
})

describe('conversationCost', () => {
  it('sums assistant usage only', () => {
    const total = conversationCost(
      [
        { role: 'user' },
        { role: 'assistant', usage: { inputTokens: 1_000_000, outputTokens: 0 }, model: 'gpt-4o' },
        { role: 'user' },
        { role: 'assistant', usage: { inputTokens: 0, outputTokens: 1_000_000 }, model: 'gpt-4o' }
      ],
      'gpt-4o'
    )
    expect(total.estimated).toBe(false)
    expect(total.usd).toBeCloseTo(12.5, 10)
  })

  it('is estimated when no message had a known price', () => {
    const total = conversationCost(
      [{ role: 'assistant', usage: { inputTokens: 5, outputTokens: 5 }, model: 'nope' }],
      'nope'
    )
    expect(total).toEqual({ usd: 0, estimated: true })
  })

  it('per-message model beats the fallback model', () => {
    const total = conversationCost(
      [{ role: 'assistant', usage: { inputTokens: 1_000_000, outputTokens: 0 }, model: 'claude-3-5-haiku' }],
      'gpt-4o'
    )
    expect(total.usd).toBeCloseTo(0.8, 10)
  })
})

describe('DEFAULT_PRICES shape', () => {
  it('exposes the documented prefixes', () => {
    expect(Object.keys(DEFAULT_PRICES).sort()).toEqual(
      ['claude-', 'claude-3-5-haiku', 'deepseek', 'gpt-', 'gpt-4o'].sort()
    )
  })
})
