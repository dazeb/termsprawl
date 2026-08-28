// Phase 11 Task 11.4 — chat driver v2 core: cost meter. Electron-free, pure.
// Per-model token prices (USD per million tokens) with longest-prefix match
// and user overrides; unknown models report estimated:true with usd 0 so the
// UI can show "n/a" instead of a fake number.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

export interface ModelPrice {
  /** USD per million input tokens. */
  in: number
  /** USD per million output tokens. */
  out: number
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'gpt-': { in: 0.5, out: 1.5 },
  'gpt-4o': { in: 2.5, out: 10 },
  'claude-': { in: 3, out: 15 },
  'claude-3-5-haiku': { in: 0.8, out: 4 },
  deepseek: { in: 0.27, out: 1.1 }
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface Cost {
  usd: number
  estimated: boolean
}

/** Longest-prefix price lookup. User overrides are checked first (exact id,
 * then prefix), then the built-in table. No match → null. */
export function priceFor(
  model: string,
  overrides?: Record<string, ModelPrice>
): ModelPrice | null {
  if (overrides) {
    const exact = overrides[model]
    if (exact) return exact
  }
  let best: { prefix: string; price: ModelPrice } | null = null
  const tables: Array<Record<string, ModelPrice>> = overrides ? [overrides, DEFAULT_PRICES] : [DEFAULT_PRICES]
  for (const table of tables) {
    for (const [prefix, price] of Object.entries(table)) {
      if (model.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
        best = { prefix, price }
      }
    }
  }
  return best?.price ?? null
}

/** Cost of one usage sample. Unknown model → { usd: 0, estimated: true }. */
export function costOf(usage: TokenUsage, model: string, overrides?: Record<string, ModelPrice>): Cost {
  const price = priceFor(model, overrides)
  if (!price) return { usd: 0, estimated: true }
  const usd = (usage.inputTokens * price.in + usage.outputTokens * price.out) / 1_000_000
  return { usd, estimated: false }
}

/** Total cost across a conversation's assistant messages (their usage
 * samples). Estimated when NO message had a known price. */
export function conversationCost(
  messages: Array<{ role: string; usage?: TokenUsage; model?: string }>,
  model: string,
  overrides?: Record<string, ModelPrice>
): Cost {
  let usd = 0
  let priced = false
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.usage) continue
    const effective = m.model ?? model
    const c = costOf(m.usage, effective, overrides)
    if (!c.estimated) {
      priced = true
      usd += c.usd
    }
  }
  return { usd, estimated: !priced }
}
