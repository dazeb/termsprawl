import { describe, expect, it } from 'vitest'
import { aggregateUsage, chatUsageSamples } from './settings-usage'

const cost = (model: string, usage: { inputTokens: number; outputTokens: number }): number =>
  model === 'known' ? (usage.inputTokens + usage.outputTokens) / 1_000_000 : 0

const chatNode = (messages: unknown[], extra: Record<string, unknown> = {}): { data: unknown } => ({
  data: { kind: 'chat', provider: 'openai', model: 'known', messages, ...extra }
})

const reply = (ts: number, inputTokens: number, outputTokens: number, extra: Record<string, unknown> = {}) => ({
  id: `m${ts}`,
  role: 'assistant',
  content: 'hi',
  ts,
  usage: { inputTokens, outputTokens },
  ...extra
})

describe('chatUsageSamples', () => {
  it('counts assistant replies and buckets them by the day they were sent', () => {
    const samples = chatUsageSamples(
      [
        chatNode([
          { id: 'u1', role: 'user', content: 'q', ts: Date.parse('2026-09-01T10:00:00Z') },
          reply(Date.parse('2026-09-01T10:00:05Z'), 100, 50),
          reply(Date.parse('2026-09-02T09:00:00Z'), 200, 25)
        ])
      ],
      cost
    )
    expect(samples.map((s) => [s.date, s.inputTokens, s.outputTokens])).toEqual([
      ['2026-09-01', 100, 50],
      ['2026-09-02', 200, 25]
    ])
    // The conversation's span becomes the session length (max across samples).
    expect(samples[0].sessionSeconds).toBe(Math.round((Date.parse('2026-09-02T09:00:00Z') - Date.parse('2026-09-01T10:00:00Z')) / 1000))
  })

  it('ignores user messages, replies without usage, and zero-token samples', () => {
    const samples = chatUsageSamples(
      [
        chatNode([
          { id: 'u', role: 'user', content: 'q', ts: 1 },
          { id: 'a1', role: 'assistant', content: 'no usage', ts: 2 },
          reply(3, 0, 0),
          { id: 'a2', role: 'assistant', content: 'no timestamp', usage: { inputTokens: 5, outputTokens: 5 } }
        ])
      ],
      cost
    )
    expect(samples).toEqual([])
  })

  it('ignores nodes that are not chat nodes, and prefers the message model', () => {
    const samples = chatUsageSamples(
      [
        { data: { kind: 'terminal', messages: [reply(1, 10, 10)] } },
        { data: { kind: 'chat', provider: 'x', model: 'known', messages: [reply(1_700_000_000_000, 1_000_000, 0, { model: 'known' })] } }
      ],
      cost
    )
    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({ provider: 'x', model: 'known', inputTokens: 1_000_000, cost: 1 })
  })
})

describe('aggregateUsage', () => {
  it('totals tokens, cost, sessions and the per-model breakdown', () => {
    const stats = aggregateUsage([
      { date: '2026-09-01', provider: 'openai', model: 'a', inputTokens: 10, outputTokens: 5, cost: 0.01, sessionSeconds: 60 },
      { date: '2026-09-01', provider: 'openai', model: 'a', inputTokens: 20, outputTokens: 5, cost: 0.02, sessionSeconds: 30 },
      { date: '2026-09-02', provider: 'anthropic', model: 'b', inputTokens: 1, outputTokens: 1, cost: 0.5 }
    ])
    expect(stats).toMatchObject({
      supported: true,
      hasData: true,
      totalInputTokens: 31,
      totalOutputTokens: 11,
      sessions: 3,
      longestSessionSeconds: 60
    })
    expect(stats.daily.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02'])
    expect(stats.models.map((m) => `${m.provider}:${m.model}`)).toEqual(['anthropic:b', 'openai:a'])
    expect(Math.round(stats.totalCost * 100)).toBe(53)
  })

  it('reports no data rather than a zeroed page when there are no samples', () => {
    expect(aggregateUsage([])).toMatchObject({ supported: true, hasData: false, daily: [], models: [] })
  })
})
