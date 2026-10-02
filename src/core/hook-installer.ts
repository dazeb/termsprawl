// Agent CLI hook installer — writes HTTP hooks into agent settings files
// that POST lifecycle events to our loopback hook server.
//
// Merge-only by design: the user's existing settings (permissions, model,
// their own hooks) are preserved. Our entries are recognised by their
// loopback /hook/claude URL, so install replaces them (the port and key
// change every boot) and uninstall removes exactly what we added.
//
// Electron-free so both the desktop main process and the Server Edition
// boot the same core.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface ClaudeHookEntry {
  matcher: string
  // Claude Code's HTTP hook type POSTs the hook input JSON to `url`.
  hooks: { type: 'http'; url: string }[]
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
// Matches our hook URL on any boot's port, with or without ?key=.
const OUR_URL = /^http:\/\/127\.0\.0\.1:\d+\/hook\/claude(\?|$)/

/** True for an entry we wrote — including pre-'http' builds that used the
 * unsupported 'url' type, so those stale entries get swept up too. */
function isOurEntry(entry: unknown): boolean {
  const hooks = (entry as { hooks?: unknown } | null)?.hooks
  if (!Array.isArray(hooks) || hooks.length === 0) return false
  return hooks.every((h: { type?: unknown; url?: unknown }) =>
    (h?.type === 'http' || h?.type === 'url') && typeof h.url === 'string' && OUR_URL.test(h.url)
  )
}

function withoutOurs(list: unknown): unknown[] {
  return Array.isArray(list) ? list.filter((e) => !isOurEntry(e)) : []
}

/** Hook config fragment for one server base URL (e.g. http://127.0.0.1:PORT/).
 * Every event POSTs to /hook/claude — the payload's hook_event_name tells the
 * server which lifecycle event fired. `secretKey` (audit B8) rides in the
 * query so the loopback server can reject spoofed POSTs from other local
 * processes; omit it only in tests. */
export function buildClaudeHookConfig(baseUrl: string, secretKey?: string): ClaudeHooksConfig {
  const suffix = secretKey ? `?key=${encodeURIComponent(secretKey)}` : ''
  const entry: ClaudeHookEntry = {
    matcher: '*',
    hooks: [{ type: 'http', url: `${baseUrl}hook/claude${suffix}` }]
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

/** Merge our HTTP hooks into settings.json at `path` (creates it if needed).
 * Idempotent: entries from earlier boots are replaced, not accumulated.
 * `secretKey` (audit B8) is embedded in the hook URL query. */
export function installClaudeHooks(settingsPath: string, baseUrl: string, secretKey?: string): void {
  const settings = readSettings(settingsPath)
  const ours = buildClaudeHookConfig(baseUrl, secretKey) as unknown as Record<string, unknown>

  settings.hooks = { ...(settings.hooks ?? {}) }
  for (const event of EVENTS) {
    const addition = ours[event] as ClaudeHookEntry[]
    settings.hooks[event] = [...withoutOurs(settings.hooks[event]), ...addition]
  }
  settings[MANAGED_MARKER] = true
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

/** Remove our hook entries plus the marker; keep the rest. */
export function uninstallClaudeHooks(settingsPath: string): void {
  if (!existsSync(settingsPath)) return
  const settings = readSettings(settingsPath)
  if (settings[MANAGED_MARKER] !== true) return

  if (settings.hooks) {
    for (const event of EVENTS) {
      if (!Array.isArray(settings.hooks[event])) continue
      const kept = withoutOurs(settings.hooks[event])
      if (kept.length === 0) delete settings.hooks[event]
      else settings.hooks[event] = kept
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks
  }
  delete settings[MANAGED_MARKER]
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

/** Path to Claude Code's user settings.json (~/.claude/settings.json). */
export function claudeSettingsPath(homeDir: string): string {
  return `${homeDir}/.claude/settings.json`
}
