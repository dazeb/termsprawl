import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRoots, discoverSubagents, type AgentRoot } from './settings-subagents'

const scratch = (): { claude: AgentRoot; codex: AgentRoot } => {
  const home = mkdtempSync(join(tmpdir(), 'ts-agents-'))
  const roots = agentRoots(home)
  for (const root of roots) mkdirSync(root.dir, { recursive: true })
  return { claude: roots[0], codex: roots[1] }
}

describe('discoverSubagents', () => {
  it('reads a Claude agent: name, description, tool list and mode', () => {
    const { claude } = scratch()
    writeFileSync(
      join(claude.dir, 'scout.md'),
      [
        '---',
        'name: scout',
        'description: Fast lookup with few calls.',
        'tools:',
        '  - Read',
        '  - Grep',
        '  - mcp__memory__search',
        'mcpServers: [memory]',
        'permissionMode: plan',
        '---',
        '',
        '# Body'
      ].join('\n')
    )
    expect(discoverSubagents([claude])).toEqual([
      {
        id: 'claude:scout',
        name: 'scout',
        description: 'Fast lookup with few calls.',
        agent: 'claude',
        tools: 3,
        detail: 'plan mode · 1 MCP',
        path: join(claude.dir, 'scout.md')
      }
    ])
  })

  it('reads a Codex agent, counting tools across its MCP tables', () => {
    const { codex } = scratch()
    writeFileSync(
      join(codex.dir, 'verify.toml'),
      [
        'name = "verify"',
        'description = "Default verification tier."',
        'sandbox_mode = "read-only"',
        '',
        '[mcp_servers.memory]',
        'command = "memory"',
        'enabled_tools = ["search", "trace", "snippet"]',
        '',
        '[mcp_servers.docs]',
        'command = "docs"',
        'enabled_tools = ["lookup"]'
      ].join('\n')
    )
    const [agent] = discoverSubagents([codex])
    expect(agent).toMatchObject({
      id: 'codex:verify',
      name: 'verify',
      description: 'Default verification tier.',
      agent: 'codex',
      tools: 4,
      detail: 'read-only · 2 MCP'
    })
  })

  it('reports no declared tools as zero, which the panel reads as "all tools"', () => {
    const { claude } = scratch()
    writeFileSync(join(claude.dir, 'plain.md'), '---\nname: plain\ndescription: No tool list\n---\n')
    expect(discoverSubagents([claude])[0]).toMatchObject({ tools: 0, detail: '' })
  })

  it('skips files without front matter or a name, and roots that do not exist', () => {
    const { claude } = scratch()
    writeFileSync(join(claude.dir, 'notes.md'), 'just notes')
    writeFileSync(join(claude.dir, 'unnamed.md'), '---\ndescription: no name\n---\n')
    writeFileSync(join(claude.dir, 'ignored.txt'), '---\nname: nope\n---\n')
    expect(discoverSubagents([claude])).toEqual([])
    expect(
      discoverSubagents([{ dir: join(claude.dir, 'nope'), agent: 'claude', format: 'md' }])
    ).toEqual([])
  })
})
