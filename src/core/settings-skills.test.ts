import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverSkills, setSkillEnabled, type SkillRoot } from './settings-skills'

const scratch = (): SkillRoot => {
  const home = mkdtempSync(join(tmpdir(), 'ts-skills-'))
  const root: SkillRoot = {
    path: join(home, 'skills'),
    disabledPath: join(home, 'skills-disabled'),
    source: 'codex',
    agent: 'codex'
  }
  mkdirSync(root.path, { recursive: true })
  return root
}

const writeSkill = (dir: string, name: string, body: string): void => {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), body)
}

describe('discoverSkills', () => {
  it('reads front matter, and falls back to the heading plus first paragraph', () => {
    const root = scratch()
    writeSkill(root.path, 'meta', '---\nname: Friendly name\ndescription: From front matter\n---\n\n# ignored\n')
    writeSkill(root.path, 'plain', '# Plain skill\n\nA description with   collapsed   spaces.\n\nMore.')
    writeSkill(root.path, 'bare', 'just text, no heading')

    const byPath = Object.fromEntries(discoverSkills([root]).map((s) => [s.path, s]))
    expect(byPath.meta.name).toBe('Friendly name')
    expect(byPath.meta.description).toBe('From front matter')
    expect(byPath.plain.name).toBe('Plain skill')
    expect(byPath.plain.description).toBe('A description with collapsed spaces.')
    expect(byPath.bare.name).toBe('bare')
    expect(byPath.bare.description).toBe('just text, no heading')
  })

  it('ignores folders without a SKILL.md, and roots that do not exist', () => {
    const root = scratch()
    mkdirSync(join(root.path, 'not-a-skill'))
    writeFileSync(join(root.path, 'a-file.txt'), 'not a skill either')
    expect(discoverSkills([root])).toEqual([])
    expect(discoverSkills([{ path: join(root.path, 'nope'), source: 'x', agent: 'x' }])).toEqual([])
  })

  it('reads folded blocks and unwraps quoted values, the way real SKILL.md files are written', () => {
    const root = scratch()
    writeSkill(
      root.path,
      'folded',
      '---\nname: Folded\ndescription: >\n  First line of the description\n  continues on the next.\nallowed-tools: Bash\n---\n\n# Body\n'
    )
    writeSkill(root.path, 'quoted', '---\ndescription: "Quoted description"\n---\n\n# Body\n')
    const byPath = Object.fromEntries(discoverSkills([root]).map((s) => [s.path, s]))
    expect(byPath.folded.description).toBe('First line of the description continues on the next.')
    expect(byPath.folded.name).toBe('Folded')
    expect(byPath.quoted.description).toBe('Quoted description')
  })

  it('reports disabled skills from the sibling folder, enabled ones first', () => {
    const root = scratch()
    writeSkill(root.path, 'on', '# On')
    writeSkill(root.disabledPath!, 'off', '# Off')
    expect(discoverSkills([root]).map((s) => [s.path, s.enabled])).toEqual([
      ['on', true],
      ['off', false]
    ])
  })
})

describe('setSkillEnabled', () => {
  it('moves a skill out of the scanned folder and back', () => {
    const root = scratch()
    writeSkill(root.path, 'mover', '# Mover')

    setSkillEnabled([root], 'codex:mover', false)
    expect(existsSync(join(root.path, 'mover'))).toBe(false)
    expect(existsSync(join(root.disabledPath!, 'mover', 'SKILL.md'))).toBe(true)
    const parked = discoverSkills([root])[0]
    expect(parked).toMatchObject({ path: 'mover', enabled: false, id: 'codex:disabled:mover' })

    // The id names the folder, so it changes with the move — the panel always
    // toggles the row it just discovered rather than a remembered id.
    setSkillEnabled([root], parked.id, true)
    expect(existsSync(join(root.path, 'mover', 'SKILL.md'))).toBe(true)
    expect(discoverSkills([root])[0]).toMatchObject({ path: 'mover', enabled: true })
  })

  it('is a no-op when the skill is already in the asked-for state', () => {
    const root = scratch()
    writeSkill(root.path, 'steady', '# Steady')
    setSkillEnabled([root], 'codex:steady', true)
    expect(existsSync(join(root.path, 'steady'))).toBe(true)
  })

  it('refuses an unknown skill instead of guessing', () => {
    expect(() => setSkillEnabled([scratch()], 'codex:ghost', false)).toThrow(/unknown skill/)
  })

  it('refuses to overwrite a skill that already exists in the target folder', () => {
    const root = scratch()
    writeSkill(root.path, 'clash', '# Enabled copy')
    writeSkill(root.disabledPath!, 'clash', '# Disabled copy')
    // Both copies are discovered; enabling the disabled one must not clobber
    // the enabled one — that would be silent data loss, not a convenience.
    // The disabled copy has its own id, so this targets exactly one folder.
    expect(() => setSkillEnabled([root], 'codex:disabled:clash', true)).toThrow(/already exists/)
    expect(existsSync(join(root.path, 'clash', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root.disabledPath!, 'clash', 'SKILL.md'))).toBe(true)
  })

  it('gives each physical folder its own id, so two copies never collide', () => {
    const root = scratch()
    writeSkill(root.path, 'same', '# Enabled copy')
    writeSkill(root.disabledPath!, 'same', '# Disabled copy')
    expect(discoverSkills([root]).map((s) => s.id).sort()).toEqual(['codex:disabled:same', 'codex:same'])
  })
})
