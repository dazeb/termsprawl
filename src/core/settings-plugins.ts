// Plugin discovery for the settings panel's Plugins page.
//
// Both agent CLIs cache installed plugins on disk with a manifest, and Codex
// records the enable flag in its own config.toml:
//
//   ~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/.codex-plugin/plugin.json
//   ~/.claude/plugins/cache/<marketplace>/<plugin>/.claude-plugin/plugin.json
//   ~/.codex/config.toml → [plugins."<plugin>@<marketplace>"] enabled = true
//
// "Installed" is therefore the cache (a real inventory), and "enabled" is the
// CLI's own flag — which is why this page can offer a toggle without inventing
// state: it edits that one key and nothing else.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsPlugin } from '../shared/types'

export interface PluginRoot {
  /** Directory holding `<marketplace>/<plugin>/…` */
  dir: string
  agent: string
  /** Manifest folder name inside a plugin version directory. */
  manifestDir: '.codex-plugin' | '.claude-plugin'
}

export function pluginRoots(home: string): PluginRoot[] {
  return [
    { dir: join(home, '.codex', 'plugins', 'cache'), agent: 'codex', manifestDir: '.codex-plugin' },
    { dir: join(home, '.claude', 'plugins', 'cache'), agent: 'claude', manifestDir: '.claude-plugin' },
    // Older Claude layout without the cache/ level.
    { dir: join(home, '.claude', 'plugins'), agent: 'claude', manifestDir: '.claude-plugin' },
  ]
}

/** `[plugins."name@marketplace"]` → enabled flag, read from a Codex config. */
export function pluginEnabledStates(configPath: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return out
  }
  let current: string | null = null
  for (const line of raw.split(/\r?\n/)) {
    const header = /^\s*\[plugins\."([^"]+)"\]\s*$/.exec(line)
    if (header) {
      current = header[1]
      continue
    }
    if (/^\s*\[/.test(line)) {
      current = null
      continue
    }
    if (!current) continue
    const flag = /^\s*enabled\s*=\s*(true|false)\s*$/.exec(line)
    if (flag) out.set(current, flag[1] === 'true')
  }
  return out
}

/** Directories that never hold a skill or an agent definition. Plugin caches
 * ship assets, tests and fixture trees; walking them was most of the scan cost
 * for zero information. */
const SKIP_DIRS = new Set(['node_modules', 'assets', 'tests', 'dist', 'build', 'coverage', '.git'])

/** Count files matching `want` under `dir`, stopping at `depth` levels. */
function countUpTo(dir: string, want: (name: string) => boolean, depth: number): number {
  if (depth < 0) return 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  let total = 0
  for (const name of entries) {
    const path = join(dir, name)
    let isDir = false
    try {
      isDir = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (!isDir) {
      if (want(name)) total += 1
      continue
    }
    if (SKIP_DIRS.has(name)) continue
    total += countUpTo(path, want, depth - 1)
  }
  return total
}

interface Manifest {
  name?: string
  version?: string
  description?: string
}

function readManifest(dir: string, manifestDir: string): Manifest | null {
  const file = join(dir, manifestDir, 'plugin.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest
  } catch {
    return null // a half-written manifest is a missing plugin, not a crash
  }
}

/** Newest version directory wins when a plugin is cached more than once. */
function compareVersions(a: string, b: string): number {
  const left = a.split(/[^\w]+/).filter(Boolean)
  const right = b.split(/[^\w]+/).filter(Boolean)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? ''
    const y = right[i] ?? ''
    const nx = Number(x)
    const ny = Number(y)
    // Numeric segments compare as numbers, so 1.10 beats 1.8 (a plain string
    // sort puts '1.10' first, which is how a stale cache entry wins a race).
    if (x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny
      continue
    }
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function pluginVersionDir(pluginDir: string, manifestDir: string): string | null {
  if (existsSync(join(pluginDir, manifestDir, 'plugin.json'))) return pluginDir
  let versions: string[] = []
  try {
    versions = readdirSync(pluginDir).filter((name) => {
      try {
        return statSync(join(pluginDir, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return null
  }
  const withManifest = versions.filter((v) => existsSync(join(pluginDir, v, manifestDir, 'plugin.json')))
  if (withManifest.length === 0) return null
  return join(pluginDir, withManifest.sort(compareVersions).at(-1)!)
}

/** Every cached plugin, newest version per plugin, enabled state from config. */
export function discoverPlugins(
  roots: PluginRoot[],
  configPath: string,
  enabledStates: Map<string, boolean> = pluginEnabledStates(configPath)
): SettingsPlugin[] {
  const out: SettingsPlugin[] = []
  for (const root of roots) {
    let marketplaces: string[]
    try {
      marketplaces = readdirSync(root.dir)
    } catch {
      continue // the CLI is not installed, or has no plugins yet
    }
    for (const marketplace of marketplaces) {
      const marketplaceDir = join(root.dir, marketplace)
      let plugins: string[]
      try {
        plugins = readdirSync(marketplaceDir)
      } catch {
        continue
      }
      for (const plugin of plugins) {
        const dir = pluginVersionDir(join(marketplaceDir, plugin), root.manifestDir)
        if (!dir) continue
        const manifest = readManifest(dir, root.manifestDir)
        if (!manifest) continue
        const key = `${manifest.name ?? plugin}@${marketplace}`
        out.push({
          id: `${root.agent}:${key}`,
          name: manifest.name ?? plugin,
          description: (manifest.description ?? '').split(/\n\s*\n/)[0]?.trim() ?? '',
          marketplace,
          version: manifest.version ?? '',
          enabled: enabledStates.get(key) === true,
          skills: countUpTo(join(dir, 'skills'), (name) => name === 'SKILL.md', 3),
          agents: countUpTo(join(dir, 'agents'), (name) => /\.(md|toml|ya?ml)$/.test(name), 2),
          configPath,
        })
      }
    }
  }
  // One row per plugin even when both roots somehow carry it.
  const byKey = new Map<string, SettingsPlugin>()
  for (const plugin of out) {
    const existing = byKey.get(plugin.id)
    if (!existing || plugin.skills + plugin.agents > existing.skills + existing.agents) byKey.set(plugin.id, plugin)
  }
  return [...byKey.values()].sort((a, b) => a.enabled === b.enabled ? a.name.localeCompare(b.name) : Number(b.enabled) - Number(a.enabled))
}

/** Flip one plugin's `enabled` flag in the CLI's config.
 *
 * Surgical on purpose: it rewrites exactly one key inside the plugin's own
 * table and leaves every other byte of the file alone. A missing table is
 * appended, which is how the CLI records a newly enabled plugin. */
export function setPluginEnabled(configPath: string, key: string, enabled: boolean): void {
  const header = `[plugins."${key}"]`
  const lines: string[] = existsSync(configPath) ? readFileSync(configPath, 'utf8').split(/\r?\n/) : []
  const headerAt = lines.findIndex((line) => line.trim() === header)
  if (headerAt === -1) {
    const trimmed = lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
    const next = [...trimmed, '', header, `enabled = ${enabled}`]
    writeFileSync(configPath, next.join('\n') + '\n')
    return
  }
  let end = lines.length
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i
      break
    }
  }
  const flagAt = lines.findIndex((line, i) => i > headerAt && i < end && /^\s*enabled\s*=/.test(line))
  if (flagAt === -1) lines.splice(headerAt + 1, 0, `enabled = ${enabled}`)
  else lines[flagAt] = `enabled = ${enabled}`
  writeFileSync(configPath, lines.join('\n'))
}
