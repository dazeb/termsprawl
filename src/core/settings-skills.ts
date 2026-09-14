// Skill discovery for the settings panel's Skills page.
//
// Each agent CLI scans exactly one directory for skills (`~/.claude/skills`,
// `~/.codex/skills`), and a skill is a folder holding a `SKILL.md`. That gives
// "disabled" a real, reversible meaning without any state of our own: move the
// folder into the sibling `skills-disabled/` and the CLI stops seeing it.
// Nothing here ever deletes a skill.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsSkill } from '../shared/types'

/** The sibling folder a disabled skill is parked in. */
export const DISABLED_DIR = 'skills-disabled'

export interface SkillRoot {
  /** Directory the CLI scans. */
  path: string
  /** Label for the scope filter ('claude' | 'codex'). */
  source: string
  /** Agent CLI that owns the root. */
  agent: string
  /** Where disabled skills live. Defaults to the sibling `skills-disabled/`. */
  disabledPath?: string
}

/** The skill roots termsprawl knows how to read. */
export function skillRoots(home: string): SkillRoot[] {
  return [
    { path: join(home, '.claude', 'skills'), source: 'claude', agent: 'claude' },
    { path: join(home, '.codex', 'skills'), source: 'codex', agent: 'codex' }
  ]
}

export const disabledDirFor = (root: SkillRoot): string =>
  root.disabledPath ?? join(root.path, '..', DISABLED_DIR)

const unquote = (value: string): string =>
  /^(["'])[\s\S]*\1$/.test(value) ? value.slice(1, -1).trim() : value

/** Front-matter value for `key`, including YAML block scalars.
 *
 * Real SKILL.md files overwhelmingly use one of three shapes, and a line-based
 * read only handles the first:
 *   description: One line
 *   description: >          ← folded block, the value is on the NEXT lines
 *   description: "Quoted"   ← the quotes are YAML syntax, not text */
function frontMatterValue(text: string, key: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (!front) return undefined
  const lines = front.split(/\r?\n/)
  const keyLine = new RegExp(`^${key}\\s*:`)
  const start = lines.findIndex((line) => keyLine.test(line))
  if (start < 0) return undefined
  const inline = lines[start].replace(keyLine, '').trim()
  if (inline && !/^[>|][+-]?$/.test(inline)) return unquote(inline)
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break // the block ends at the next top-level key
    block.push(line.trim())
  }
  const folded = block.join(' ').trim()
  return folded ? unquote(folded) : undefined
}

/** First paragraph that is neither the title nor front matter — the fallback
 * description for a SKILL.md without a `description:` key. */
function firstParagraph(text: string): string {
  const body = text.replace(/^---[\s\S]*?---\s*/m, '')
  for (const chunk of body.split(/\n\s*\n/)) {
    const line = chunk.replace(/\s+/g, ' ').trim()
    if (!line || line.startsWith('#')) continue
    return line.slice(0, 240)
  }
  return ''
}

function readSkill(dir: string, root: SkillRoot, enabled: boolean): SettingsSkill | null {
  let text: string
  try {
    text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return null // a folder without SKILL.md is not a skill
  }
  const name = dir.slice(dir.lastIndexOf('/') + 1)
  // Identity is the folder name, not the front-matter `id`: the folder is what
  // the toggle moves, and two folders (one enabled, one parked) can legitimately
  // share a front-matter id. The disabled copy gets its own id so the panel can
  // address it and put it back.
  return {
    id: enabled ? `${root.source}:${name}` : `${root.source}:disabled:${name}`,
    name: frontMatterValue(text, 'name') || /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || name,
    description: frontMatterValue(text, 'description') || firstParagraph(text),
    source: root.source,
    agent: root.agent,
    path: name,
    enabled
  }
}

function readRoot(root: SkillRoot, enabled: boolean): SettingsSkill[] {
  const dir = enabled ? root.path : disabledDirFor(root)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return [] // no such folder yet — an empty root, not an error
  }
  const out: SettingsSkill[] = []
  for (const name of names.sort()) {
    const dirPath = join(dir, name)
    try {
      if (!statSync(dirPath).isDirectory()) continue
    } catch {
      continue
    }
    const skill = readSkill(dirPath, root, enabled)
    if (skill) out.push(skill)
  }
  return out
}

/** Every skill across every root: enabled ones first, then by id. */
export function discoverSkills(roots: SkillRoot[]): SettingsSkill[] {
  const all = roots.flatMap((root) => [...readRoot(root, true), ...readRoot(root, false)])
  return all.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id))
}

/** Move a skill between the scanned and the disabled folder.
 *
 * Throws on an unknown id, and on a destination that already exists: both mean
 * the panel is out of sync with disk, and overwriting a skill folder would be
 * data loss rather than a convenience. */
export function setSkillEnabled(roots: SkillRoot[], id: string, enabled: boolean): void {
  const skill = discoverSkills(roots).find((s) => s.id === id)
  if (!skill) throw new Error(`unknown skill: ${id}`)
  if (skill.enabled === enabled) return
  const root = roots.find((r) => r.source === skill.source)
  if (!root) throw new Error(`unknown skill root: ${skill.source}`)
  const disabledDir = disabledDirFor(root)
  const from = join(skill.enabled ? root.path : disabledDir, skill.path)
  const to = join(skill.enabled ? disabledDir : root.path, skill.path)
  if (existsSync(to)) throw new Error(`already exists: ${to}`)
  mkdirSync(disabledDir, { recursive: true })
  renameSync(from, to)
}
