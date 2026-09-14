import type { UsageStats } from '../shared/types'
export interface UsageSample { date: string; provider: string; model: string; inputTokens: number; outputTokens: number; cost: number; sessionSeconds?: number }

/** The assistant-message shape saved inside a chat node. Structural on
 * purpose: core must not import the renderer's node types. */
interface ChatNodeLike {
  kind?: string
  provider?: string
  model?: string
  messages?: Array<{
    role?: string
    ts?: number
    model?: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }>
}

/** Turn saved chat nodes into usage samples.
 *
 * The tokens and timestamps are already in the workspace file — chat nodes
 * record `usage` per assistant reply — so usage needs no collection of its own,
 * only counting. `cost` is injected so the price table stays in one place.
 * Messages without a numeric timestamp are skipped rather than bucketed into
 * "today", which would invent activity that never happened. */
export function chatUsageSamples(
  nodes: ReadonlyArray<{ data?: unknown }>,
  cost: (model: string, usage: { inputTokens: number; outputTokens: number }) => number
): UsageSample[] {
  const out: UsageSample[] = []
  for (const node of nodes) {
    const data = node?.data as ChatNodeLike | undefined
    if (!data || data.kind !== 'chat' || !Array.isArray(data.messages)) continue
    const stamps = data.messages.map((m) => m.ts).filter((ts): ts is number => Number.isFinite(ts))
    const sessionSeconds = stamps.length > 1 ? Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000) : 0
    for (const message of data.messages) {
      const ts = message.ts
      if (message.role !== 'assistant' || !message.usage || typeof ts !== 'number' || !Number.isFinite(ts)) continue
      const inputTokens = Math.max(0, Number(message.usage.inputTokens) || 0)
      const outputTokens = Math.max(0, Number(message.usage.outputTokens) || 0)
      if (inputTokens + outputTokens === 0) continue
      const model = message.model || data.model || 'unknown'
      out.push({
        date: new Date(ts).toISOString().slice(0, 10),
        provider: data.provider || 'unknown',
        model,
        inputTokens,
        outputTokens,
        cost: cost(model, { inputTokens, outputTokens }),
        sessionSeconds
      })
    }
  }
  return out
}
export function aggregateUsage(samples: UsageSample[]): UsageStats { const daily = new Map<string, UsageStats['daily'][number]>(); const models = new Map<string, UsageStats['models'][number]>(); let longest = 0; for (const s of samples) { const d = daily.get(s.date) ?? { date:s.date,inputTokens:0,outputTokens:0,cost:0 }; d.inputTokens += s.inputTokens; d.outputTokens += s.outputTokens; d.cost += s.cost; daily.set(s.date,d); const key=`${s.provider}:${s.model}`; const m=models.get(key) ?? {provider:s.provider,model:s.model,inputTokens:0,outputTokens:0,cost:0}; m.inputTokens+=s.inputTokens;m.outputTokens+=s.outputTokens;m.cost+=s.cost;models.set(key,m); longest=Math.max(longest,s.sessionSeconds??0) } const totalInputTokens=samples.reduce((n,s)=>n+s.inputTokens,0), totalOutputTokens=samples.reduce((n,s)=>n+s.outputTokens,0), totalCost=samples.reduce((n,s)=>n+s.cost,0); return {supported:true,hasData:samples.length>0,totalInputTokens,totalOutputTokens,totalCost,sessions:samples.length,longestSessionSeconds:longest,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),models:[...models.values()].sort((a,b)=>`${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`))} }
