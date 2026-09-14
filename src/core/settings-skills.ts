import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { SettingsSkill } from '../shared/types'

export interface SkillRoot { path: string; source: string }
export function discoverSkills(roots: SkillRoot[]): SettingsSkill[] {
  const out = new Map<string, SettingsSkill>()
  for (const root of roots) {
    if (!existsSync(root.path)) continue
    let dirs: string[]
    try { dirs = readdirSync(root.path).sort() } catch { continue }
    for (const dir of dirs) {
      const folder = join(root.path, dir); let st
      try { st = statSync(folder) } catch { continue }
      if (!st.isDirectory()) continue
      const file = join(folder, 'SKILL.md'); if (!existsSync(file)) continue
      let text = ''; try { text = readFileSync(file, 'utf8') } catch { continue }
      const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || dir
      const desc = text.split(/\n\s*\n/)[1]?.replace(/\s+/g, ' ').trim().slice(0, 240) || ''
      const id = `${root.source}:${dir}`
      if (!out.has(id)) out.set(id, { id, name: heading, description: desc, source: root.source, path: basename(root.path) + '/' + dir, enabled: true })
    }
  }
  return [...out.values()].sort((a,b) => a.id.localeCompare(b.id))
}
