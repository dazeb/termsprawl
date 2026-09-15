// Subagent discovery for the settings panel's Subagents page.
//
// Both CLIs let you define reusable subagents as files in their own config
// tree, and both declare what those agents may do:
//
//   ~/.claude/agents/<name>.md    front matter: name, description, tools[],
//                                 mcpServers[], permissionMode
//   ~/.codex/agents/<name>.toml   name, description, sandbox_mode,
//                                 [mcp_servers.*] enabled_tools[]
//
// The page reports what the CLIs will load. It does not offer a model picker
// (the reference does) because the model a subagent runs on belongs to the CLI,
// and faking that control would be worse than not having it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsSubagent } from '../shared/types'

export interface AgentRoot {
  dir: string
  agent: string
  format: 'md' | 'toml'
}

export function agentRoots(home: string): AgentRoot[] {
  return [
    { dir: join(home, '.claude', 'agents'), agent: 'claude', format: 'md' },
    { dir: join(home, '.codex', 'agents'), agent: 'codex', format: 'toml' },
  ]
}

/** Front-matter block, or null when the file has none. */
function frontMatter(text: string): string | null {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? null
}

const scalar = (front: string, key: string): string | undefined => {
  const value = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi').exec(front)?.[1]?.trim()
  if (!value) return undefined
  return /^(["'])[\s\S]*\1$/.test(value) ? value.slice(1, -1).trim() : value
}

/** A YAML list under `key:` — block form (`- item` lines) or inline (`[a, b]`)
 * — plus the top-level entries of a TOML table's `enabled_tools` array. */
function listUnder(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex((line) => new RegExp(`^${key}\\s*:`, 'i').test(line))
  if (at === -1) return []
  const inline = /\[(.*)\]/.exec(lines[at])?.[1]
  if (inline !== undefined) {
    return inline.split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
  const out: string[] = []
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s*(.+?)\s*$/.exec(line)
    if (!item) {
      if (/^\S/.test(line)) break
      continue
    }
    out.push(item[1].replace(/^["']|["']$/g, ''))
  }
  return out
}

/** Tool names declared anywhere in a Codex agent file (`enabled_tools = [...]`). */
const tomlTools = (text: string): string[] =>
  [...text.matchAll(/^\s*enabled_tools\s*=\s*\[(.*?)\]/gms)]
    .flatMap((m) => m[1].split(','))
    .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

function fromClaude(text: string, file: string, agent: string): SettingsSubagent | null {
  const front = frontMatter(text)
  if (!front) return null
  const name = scalar(front, 'name')
  if (!name) return null
  const tools = listUnder(front, 'tools')
  const servers = listUnder(front, 'mcpServers')
  const mode = scalar(front, 'permissionMode')
  return {
    id: `${agent}:${name}`,
    name,
    description: scalar(front, 'description') ?? '',
    agent,
    tools: tools.length,
    detail: [mode ? `${mode} mode` : '', servers.length ? `${servers.length} MCP` : ''].filter(Boolean).join(' · '),
    path: file,
  }
}

function fromCodex(text: string, file: string, agent: string): SettingsSubagent | null {
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1]
  if (!name) return null
  const tools = tomlTools(text)
  const mode = /^\s*sandbox_mode\s*=\s*"([^"]+)"/m.exec(text)?.[1]
  const servers = [...text.matchAll(/^\s*\[mcp_servers\./gm)].length
  return {
    id: `${agent}:${name}`,
    name,
    description: /^\s*description\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? '',
    agent,
    tools: tools.length,
    detail: [mode ? `${mode}` : '', servers ? `${servers} MCP` : ''].filter(Boolean).join(' · '),
    path: file,
  }
}

/** Every subagent definition the CLIs on this machine will load. */
export function discoverSubagents(roots: AgentRoot[]): SettingsSubagent[] {
  const out: SettingsSubagent[] = []
  for (const root of roots) {
    let files: string[]
    try {
      files = readdirSync(root.dir)
    } catch {
      continue // no such directory: a CLI with no custom agents
    }
    for (const file of files.sort()) {
      const suffix = root.format === 'md' ? '.md' : '.toml'
      if (!file.endsWith(suffix)) continue
      const path = join(root.dir, file)
      try {
        if (!statSync(path).isFile()) continue
      } catch {
        continue
      }
      let text: string
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      const parsed = root.format === 'md' ? fromClaude(text, path, root.agent) : fromCodex(text, path, root.agent)
      if (parsed) out.push(parsed)
    }
  }
  return out.sort((a, b) => a.agent.localeCompare(b.agent) || a.name.localeCompare(b.name))
}
