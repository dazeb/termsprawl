import type { AgentId } from './agents/config'

export type InstallableAgent = Exclude<AgentId, 'custom'>
export type DependencyId = InstallableAgent | 'tmux' | 'git' | 'curl' | 'tar' | 'unzip' | 'bash'
export interface DependencyStatus {
  id: DependencyId
  name: string
  state: 'missing' | 'installed' | 'incompatible'
  path?: string
  version?: string
  managed: boolean
  detail?: string
  latest?: string
  updateError?: string
  instructions?: string
}
export interface SetupJob {
  id: string
  agent: InstallableAgent
  state: 'installing' | 'installed' | 'failed'
  phase: string
  logs: string
  version?: string
  error?: string
}
export interface SetupSnapshot {
  dependencies: DependencyStatus[]
  job: SetupJob | null
  systemCommand: string | null
  restartRequired: boolean
}
export interface DependencyApi {
  check(refresh?: boolean): Promise<SetupSnapshot>
  install(id: InstallableAgent): Promise<SetupJob>
  checkUpdates(): Promise<SetupSnapshot>
  status(): Promise<SetupJob | null>
}
