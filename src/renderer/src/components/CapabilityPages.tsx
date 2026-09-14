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
  const rows = data[kind]
  return <Card><div className="flex justify-end"><Button onClick={load}>Refresh</Button></div>{rows.length === 0 ? <Status>No {kind} found.</Status> : rows.map((row, i) => <div key={i} className="border-b border-edge py-3 text-sm text-ink">{label(row)}<div className="text-xs text-mute">{(row as any).description ?? (row as any).command ?? (row as any).source}</div></div>)}</Card>
}

export function UsagePage(): React.JSX.Element {
  const [data, setData] = useState<UsageStats | null>(null); const [error, setError] = useState<string | null>(null)
  const load = (): void => { setError(null); void window.termsprawl.settings.usage().then(setData).catch((e) => setError(String(e))) }
  useEffect(load, [])
  if (error) return <Card><Status>{error}</Status><Button onClick={load}>Refresh</Button></Card>
  if (!data) return <Card><Status>Loading…</Status></Card>
  return <Card><div className="flex justify-end"><Button onClick={load}>Refresh</Button></div>{data.hasData ? <Status>Usage data available.</Status> : <Status>No usage data yet.</Status>}</Card>
}
