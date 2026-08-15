// Claude Code hook installer — writes URL hooks into ~/.claude/settings.json
// that POST lifecycle events to our loopback hook server.
//
// Merge-only by design: the user's existing settings (permissions, model,
// their own hooks) are preserved. Our contribution is marked with
// __termsprawlManaged so uninstall can remove exactly what we added.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface ClaudeHookEntry {
  matcher: string
  hooks: { type: 'url'; url: string }[]
}

export interface ClaudeHooksConfig {
  PreToolUse: ClaudeHookEntry[]
  PostToolUse: ClaudeHookEntry[]
  Notification: ClaudeHookEntry[]
  Stop: ClaudeHookEntry[]
  UserPromptSubmit: ClaudeHookEntry[]
}

const MANAGED_MARKER = '__termsprawlManaged'
const EVENTS = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit'] as const

/** Hook config fragment for one server base URL (e.g. http://127.0.0.1:PORT/).
 * Every event POSTs to /hook/claude — the payload's hook_event_name tells the
 * server which lifecycle event fired. */
export function buildClaudeHookConfig(baseUrl: string): ClaudeHooksConfig {
  const entry: ClaudeHookEntry = {
    matcher: '*',
    hooks: [{ type: 'url', url: `${baseUrl}hook/claude` }]
  }
  return {
    PreToolUse: [entry],
    PostToolUse: [entry],
    Notification: [entry],
    Stop: [entry],
    UserPromptSubmit: [entry]
  } as ClaudeHooksConfig
}

interface SettingsFile {
  hooks?: Record<string, unknown>
  [key: string]: unknown
}

function readSettings(path: string): SettingsFile {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SettingsFile
  } catch {
    return {}
  }
}

/** Merge our URL hooks into settings.json at `path` (creates it if needed). */
export function installClaudeHooks(settingsPath: string, baseUrl: string): void {
  const settings = readSettings(settingsPath)
  const ours = buildClaudeHookConfig(baseUrl) as unknown as Record<string, unknown>

  settings.hooks = { ...(settings.hooks ?? {}) }
  for (const event of EVENTS) {
    const existing = (settings.hooks[event] as ClaudeHookEntry[] | undefined) ?? []
    const addition = ours[event] as ClaudeHookEntry[]
    settings.hooks[event] = [...existing, ...addition]
  }
  settings[MANAGED_MARKER] = true
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

/** Remove the last hook entry per event (ours) plus the marker; keep the rest. */
export function uninstallClaudeHooks(settingsPath: string): void {
  if (!existsSync(settingsPath)) return
  const settings = readSettings(settingsPath)
  if (settings[MANAGED_MARKER] !== true) return

  if (settings.hooks) {
    for (const event of EVENTS) {
      const list = settings.hooks[event] as ClaudeHookEntry[] | undefined
      if (Array.isArray(list) && list.length > 0) list.pop() // ours is appended last
      if (Array.isArray(list) && list.length === 0) delete settings.hooks[event]
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks
  }
  delete settings[MANAGED_MARKER]
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

/** Path to Claude Code's user settings.json (~/.claude/settings.json). */
export function claudeSettingsPath(home: string): string {
  return `${home}/.claude/settings.json`
}
