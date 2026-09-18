import { create } from 'zustand'
import type { InstallableAgent, SetupSnapshot } from '@shared/dependencies'
interface SetupState {
  open: boolean
  requested: InstallableAgent | null
  snapshot: SetupSnapshot | null
  error: string | null
  show(agent?: InstallableAgent): void
  close(): void
  refresh(): Promise<void>
}
export const useSetup = create<SetupState>((set) => ({
  open: false, requested: null, snapshot: null, error: null,
  show: (agent) => set({ open: true, requested: agent ?? null }),
  close: () => set({ open: false }),
  refresh: async () => {
    if (!window.termsprawl.dependencies) return
    try { set({ snapshot: await window.termsprawl.dependencies.check(true), error: null }) }
    catch (error) { set({ error: String(error) }) }
  }
}))
export function setupNoticeNeeded(snapshot: SetupSnapshot | null): boolean {
  return !!snapshot?.dependencies.some(d => ['tmux', 'git'].includes(d.id) && d.state !== 'installed')
}
export function updateAvailable(current?: string, latest?: string): boolean {
  if (!current || !latest) return false
  const a = latest.split('.').map(Number), b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}
