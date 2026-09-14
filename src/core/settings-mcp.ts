// MCP server discovery for the settings panel's MCP Servers page.
//
// termsprawl does not host MCP servers and does not rewrite the agent CLIs'
// config: each CLI declares its own servers and launches them. What we can do
// honestly is read those declarations, so the panel answers "which MCP servers
// will my agents start?" without inventing state we do not own.
//
// Two shapes exist in the wild:
//   Claude Code  ~/.claude.json        { "mcpServers": { "<name>": {…} } }
//   Codex        ~/.codex/config.toml  [mcp_servers.<name>]  command/args/url
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsMcpServer } from '../shared/types'

export interface McpFile {
  path: string
  agent: string
  format: 'json' | 'toml'
}

/** The config files termsprawl reads for MCP declarations. */
export function mcpFiles(home: string): McpFile[] {
  return [
    { path: join(home, '.claude.json'), agent: 'claude', format: 'json' },
    { path: join(home, '.codex', 'config.toml'), agent: 'codex', format: 'toml' }
  ]
}

/** Quote-aware split of a TOML array literal: `["a", "b c"]` → ['a', 'b c']. */
function tomlArray(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ',') {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

const tomlString = (value: string): string => value.trim().replace(/^["']/, '').replace(/["']$/, '')

/** A server entry from either shape, normalised into one row. */
function toServer(
  name: string,
  agent: string,
  configPath: string,
  entry: { command?: string; args?: string[]; url?: string }
): SettingsMcpServer {
  const url = entry.url?.trim()
  const command = entry.command?.trim()
  const transport: SettingsMcpServer['transport'] = url ? 'http' : 'stdio'
  const detail = url ?? [command, ...(entry.args ?? [])].filter(Boolean).join(' ')
  return {
    id: `${agent}:${name}`,
    name,
    agent,
    transport,
    detail: detail || '(no command or url declared)',
    configPath
  }
}

export function parseClaudeMcp(raw: string, agent: string, configPath: string): SettingsMcpServer[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [] // a half-written config is not a discovery failure
  }
  const servers = (parsed as { mcpServers?: Record<string, unknown> })?.mcpServers
  if (!servers || typeof servers !== 'object') return []
  return Object.entries(servers)
    .map(([name, value]) => {
      const entry = (value ?? {}) as { command?: string; args?: unknown; url?: string }
      const args = Array.isArray(entry.args) ? entry.args.map(String) : []
      return toServer(name, agent, configPath, { command: entry.command, args, url: entry.url })
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function parseCodexMcp(raw: string, agent: string, configPath: string): SettingsMcpServer[] {
  const out: SettingsMcpServer[] = []
  let current: { name: string; command?: string; args?: string[]; url?: string } | null = null
  for (const line of raw.split(/\r?\n/)) {
    const section = /^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^\]]+))\]\s*$/.exec(line)
    if (section) {
      if (current) out.push(toServer(current.name, agent, configPath, current))
      current = { name: (section[1] ?? section[2] ?? section[3]).trim() }
      continue
    }
    if (/^\s*\[/.test(line)) {
      // Any other table ends the mcp_servers block we were reading.
      if (current) out.push(toServer(current.name, agent, configPath, current))
      current = null
      continue
    }
    if (!current) continue
    const kv = /^\s*(command|url|args)\s*=\s*(.+?)\s*$/.exec(line)
    if (!kv) continue
    const [, key, value] = kv
    if (key === 'args') current.args = tomlArray(value)
    else if (key === 'command') current.command = tomlString(value)
    else current.url = tomlString(value)
  }
  if (current) out.push(toServer(current.name, agent, configPath, current))
  return out
}

/** Every MCP server declared across the given config files, sorted by id. */
export function inventoryMcp(files: McpFile[]): SettingsMcpServer[] {
  return files
    .flatMap((file) => {
      let raw: string
      try {
        raw = readFileSync(file.path, 'utf8')
      } catch {
        return [] // the CLI may not be installed on this machine
      }
      return file.format === 'json'
        ? parseClaudeMcp(raw, file.agent, file.path)
        : parseCodexMcp(raw, file.agent, file.path)
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}
