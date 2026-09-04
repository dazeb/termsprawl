// Codex CLI hook installer (command-type hooks in ~/.codex/config.toml).
//
// Codex (0.149+) runs command handlers on lifecycle events and POSTs nothing
// itself — so our handler is a `curl` that relays the event JSON to the
// termsprawl loopback hook server (/hook/codex), where the codex normalizer
// lives. The payload rides stdin (codex passes event JSON on stdin); curl
// forwards it verbatim.
//
// Merge-only like the Claude installer: the user's existing hooks are
// preserved. Our entries are marked with a `__termsprawl` key on the handler
// table so uninstall removes exactly what we added (TOML allows extra keys —
// unknown keys are ignored by codex's hook engine, which reads
// type/command/timeout/matcher only).
//
// Fail-open: if termsprawl is closed, curl fails silently and the hook
// returns no output — codex continues normally.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

interface HookHandler {
  type?: string
  command?: string
  timeout?: number
  [key: string]: unknown
}

interface HookEventTable {
  matcher?: string
  hooks?: HookHandler[]
  [key: string]: unknown
}

const MANAGED_KEY = '__termsprawl'
/** Codex events that map to badge statuses (see normalizeCodexHook). The
 * lifecycle-only events are installed too so the session stays visible. */
const EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'PermissionRequest',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'PreCompact',
  'PostCompact'
] as const

const TABLE_RE = /^\s*\[\[?hooks\.[A-Za-z]+/

function handlerCommand(baseUrl: string, secretKey?: string): string {
  const suffix = secretKey ? `?key=${encodeURIComponent(secretKey)}` : ''
  return [
    'curl',
    '-s',
    '-o /dev/null',
    '-X POST',
    `-H 'Content-Type: application/json'`,
    `--data-binary @-`,
    `'${baseUrl}hook/codex${suffix}'`
  ].join(' ')
}

/** Split raw TOML into lines, tagging the start index of each top-level
 * `[headers…]`/`[[array]]` block that concerns hooks.* blocks. Returns the
 * line ranges of each hooks table: {start, end(exclusive), header}. */
function hooksTables(lines: string[]): Array<{ start: number; end: number; header: string }> {
  const starts: number[] = []
  lines.forEach((l, i) => {
    if (TABLE_RE.test(l)) starts.push(i)
  })
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length
    return { start, end, header: lines[start] }
  })
}

function blockContainsMarker(lines: string[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (lines[i].includes(MANAGED_KEY)) return true
  }
  return false
}

/**
 * Merge our codex hooks into config.toml at `path`. `baseUrl` is the hook
 * server base (e.g. http://127.0.0.1:PORT/); `secretKey` rides the query
 * (audit B8, same as the Claude installer). Creates the parent dir if needed.
 */
export function installCodexHooks(configPath: string, baseUrl: string, secretKey?: string): void {
  const raw = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  if (raw.includes(MANAGED_KEY)) return // double-install guard

  const command = handlerCommand(baseUrl, secretKey)
  const lines: string[] = raw.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  lines.push('', '# termsprawl agent-status hooks (managed — do not edit)', '')
  for (const event of EVENTS) {
    lines.push(`[[hooks.${event}.hooks]]`)
    lines.push(`matcher = "*"`)
    lines.push(`type = "command"`)
    lines.push(`command = ${tomlString(command)}`)
    lines.push(`timeout = 3`)
    lines.push(`${MANAGED_KEY} = true`)
    lines.push('')
  }
  mkdirSync(configPath.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
  writeFileSync(configPath, `${lines.join('\n')}\n`, 'utf8')
}

/** Remove our hook tables (identified by the marker key) from config.toml.
 * User tables — including user tables for the same events — are preserved. */
export function uninstallCodexHooks(configPath: string): void {
  if (!existsSync(configPath)) return
  const lines = readFileSync(configPath, 'utf8').split('\n')
  const tables = hooksTables(lines)
  const ours = new Set<number>()
  for (const t of tables) {
    if (blockContainsMarker(lines, t.start, t.end)) ours.add(t.start)
  }
  if (ours.size === 0) return
  const out = lines.filter((_, i) => {
    // Drop lines inside our tables, plus blank run immediately before them.
    if (ours.has(i)) return false
    const t = tables.find((t) => i > t.start && i < t.end)
    if (t && ours.has(t.start)) return false
    return true
  })
  // Collapse blank runs left behind at the tail.
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  writeFileSync(configPath, `${out.join('\n')}\n`, 'utf8')
}

function tomlString(v: string): string {
  // Single-quoted TOML literal string: no escapes needed for our URL/secret.
  return `'${v.replace(/'/g, "''")}'`
}

/** Path to Codex CLI's config (~/.codex/config.toml). */
export function codexConfigPath(homeDir: string): string {
  return `${homeDir}/.codex/config.toml`
}
