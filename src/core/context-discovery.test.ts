// Context-link discovery markers (Phase 7, Task 7.5). Pure block upsert plus
// fs-level guarantees that ensure markers land under the project folder only.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTEXT_LINKS_CLOSE,
  CONTEXT_LINKS_OPEN,
  ensureContextDiscovery,
  upsertManagedAgentsBlock
} from './context-discovery'

describe('upsertManagedAgentsBlock', () => {
  it('produces a block with both markers on an empty file', () => {
    const out = upsertManagedAgentsBlock('')
    expect(out).toContain(CONTEXT_LINKS_OPEN)
    expect(out).toContain(CONTEXT_LINKS_CLOSE)
  })

  it('replaces an existing block in place, leaving text above and below', () => {
    const block = upsertManagedAgentsBlock('')
    const withUser = `# my project\n\n${block}\n\nremember to hydrate`
    const out = upsertManagedAgentsBlock(withUser)
    // open + close = exactly two occurrences of the marker id, no duplication
    expect((out.match(/termsprawl:context-links/g) ?? []).length).toBe(2)
    expect(out).toContain('# my project')
    expect(out).toContain('remember to hydrate')
    expect(out.startsWith('# my project')).toBe(true)
    expect(out.trimEnd().endsWith('remember to hydrate')).toBe(true)
  })

  it('is idempotent — a second pass is unchanged', () => {
    const once = upsertManagedAgentsBlock('')
    const twice = upsertManagedAgentsBlock(once)
    expect(twice).toBe(once)
  })
})

describe('ensureContextDiscovery', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'termsprawl-disc-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('writes .termsprawl/AGENTS.md with both markers', () => {
    ensureContextDiscovery(cwd)
    const agents = readFileSync(join(cwd, '.termsprawl', 'AGENTS.md'), 'utf8')
    expect(agents).toContain(CONTEXT_LINKS_OPEN)
    expect(agents).toContain(CONTEXT_LINKS_CLOSE)
  })

  it('does not duplicate the block on a second pass and preserves user text', () => {
    ensureContextDiscovery(cwd)
    const first = readFileSync(join(cwd, '.termsprawl', 'AGENTS.md'), 'utf8')
    const agentsPath = join(cwd, '.termsprawl', 'AGENTS.md')
    writeFileSync(agentsPath, `# notes\n\n${first}`, 'utf8')
    ensureContextDiscovery(cwd)
    const second = readFileSync(agentsPath, 'utf8')
    expect((second.match(/termsprawl:context-links/g) ?? []).length).toBe(2)
    expect(second).toContain('# notes')
  })

  it('writes .claude/skills/termsprawl-context/SKILL.md', () => {
    ensureContextDiscovery(cwd)
    const skill = readFileSync(
      join(cwd, '.claude', 'skills', 'termsprawl-context', 'SKILL.md'),
      'utf8'
    )
    expect(skill).toContain('name: termsprawl-context')
    expect(skill).toContain('termsprawl-context')
  })

  it('never touches ~/ — only the given cwd', () => {
    const skillPath = join(homedir(), '.claude', 'skills', 'termsprawl-context', 'SKILL.md')
    const agentsPath = join(homedir(), '.termsprawl', 'AGENTS.md')
    const beforeSkill = existsSync(skillPath)
    const beforeAgents = existsSync(agentsPath)
    ensureContextDiscovery(cwd)
    expect(existsSync(skillPath)).toBe(beforeSkill)
    expect(existsSync(agentsPath)).toBe(beforeAgents)
  })
})
