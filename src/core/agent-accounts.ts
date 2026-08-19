// Managed agent accounts (Phase 7, Task 7.6). Electron-free.
//
// A managed account is a directory under `<userData>/accounts/<id>` that the
// agent CLI treats as its config home (CLAUDE_CONFIG_DIR for Claude). We never
// store tokens — we only create the directory the CLI writes to, so signing in
// happens inside that dir. Because the managed dir is the ONLY credential
// source, inherited auth env vars are stripped from a spawn so a stray key in
// the shell can't leak into the wrong account.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentAccount, AppSettings } from '../shared/types'

// v1 scope: Claude only (matches AgentAccount.agentId).
const ACCOUNTS_ROOT = 'accounts'

/** Auth env vars that must NEVER be inherited by a managed-account spawn. */
export const AUTH_ENV = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export interface NewAccount {
  id: string
  label: string
  configDir: string
}

/** Absolute config dir for a managed account id (under userData/accounts). */
export function accountConfigDir(userData: string, id: string): string {
  return join(userData, ACCOUNTS_ROOT, id)
}

/** A collision-resistant, safe account id (matches the isSafeProjectId shape). */
export function newAccountId(): string {
  return `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Create the managed config dir and return its record. Never stores tokens. */
export function createManagedAccount(userData: string, label: string): NewAccount {
  const id = newAccountId()
  const configDir = accountConfigDir(userData, id)
  mkdirSync(configDir, { recursive: true })
  return { id, label, configDir }
}

/** Delete a managed config dir. Missing dir is fine; never throws. Caller must
 * surface the data-loss (the login/config inside) in the UI first. */
export function deleteManagedAccount(userData: string, id: string): void {
  try {
    rmSync(accountConfigDir(userData, id), { recursive: true, force: true })
  } catch {
    // fail-open
  }
}

/** Env pair that points a Claude spawn at a managed config dir. */
export function claudeConfigEnv(configDir: string): Record<string, string> {
  return { CLAUDE_CONFIG_DIR: configDir }
}

/** Remove auth env vars from a copy so the managed dir is the only source. */
export function stripAuthEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env }
  for (const key of AUTH_ENV) delete out[key]
  return out
}

/** The active managed account, or undefined (falls back to default ~/.claude). */
export function activeAccount(settings: AppSettings): AgentAccount | undefined {
  if (!settings.activeAccountId) return undefined
  return settings.accounts.find((a) => a.id === settings.activeAccountId)
}
