import { useEffect, useState } from 'react'
import type { SettingsCapabilities, UsageStats } from '@shared/types'
import { Card, Button, Status } from './ui/kit'

const label = (row: any): string => row.name ?? (`${row.agent ?? ''}${row.event ? `: ${row.event}` : ''}`)
export function CapabilityPage({ kind }: { kind: 'skills' | 'hooks' | 'commands' }): React.JSX.Element {
  const [data, setData] = useState<SettingsCapabilities | null>(null); const [error, setError] = useState<string | null>(null)
  const load = (): void => { setError(null); void window.termsprawl.settings.capabilities().then(setData).catch((e) => setError(String(e))) }
  useEffect(load, [])
  if (error) return <Card><Status>{error}</Status><Button onClick={load}>Refresh</Button></Card>
  if (!data) return <Card><Status>Loading…</Status></Card>
  if (!data.supported) return <Card><Status>{data.reason ?? 'This capability is unavailable.'}</Status></Card>
  const rows = data[kind]
  return <Card><div className="flex justify-end"><Button onClick={load}>Refresh</Button></div>{rows.length === 0 ? <Status>No {kind} found.</Status> : rows.map((row) => <div key={'id' in row ? row.id : row.name} className="border-b border-edge py-3 text-sm text-ink">{label(row)}<div className="text-xs text-mute">{(row as any).description ?? (row as any).command ?? (row as any).source}</div></div>)}</Card>
}

export function UsagePage(): React.JSX.Element {
  const [data, setData] = useState<UsageStats | null>(null); const [error, setError] = useState<string | null>(null)
  const load = (): void => { setError(null); void window.termsprawl.settings.usage().then(setData).catch((e) => setError(String(e))) }
  useEffect(load, [])
  if (error) return <Card><Status>{error}</Status><Button onClick={load}>Refresh</Button></Card>
  if (!data) return <Card><Status>Loading…</Status></Card>
  if (!data.supported) return <Card><Status>{data.reason ?? 'Usage collection is unavailable.'}</Status></Card>
  return <Card><div className="flex justify-end"><Button onClick={load}>Refresh</Button></div>{data.hasData ? <><Status>Sessions: {data.sessions} · Input: {data.totalInputTokens} · Output: {data.totalOutputTokens} · Cost: ${data.totalCost.toFixed(2)} · Longest: {data.longestSessionSeconds}s</Status>{data.daily.map((d) => <div key={d.date}>{d.date}: {d.inputTokens} in / {d.outputTokens} out / ${d.cost.toFixed(2)}</div>)}{data.models.map((m) => <div key={`${m.provider}:${m.model}`}>{m.provider} / {m.model}: {m.inputTokens} in / {m.outputTokens} out / ${m.cost.toFixed(2)}</div>)}</> : <Status>{data.reason ?? 'No usage data has been collected yet.'}</Status>}</Card>
}
