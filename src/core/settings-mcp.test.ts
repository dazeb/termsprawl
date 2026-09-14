import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inventoryMcp, parseClaudeMcp, parseCodexMcp } from './settings-mcp'

describe('parseClaudeMcp', () => {
  it('reads stdio and http servers from .claude.json', () => {
    const raw = JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
        context7: { url: 'https://mcp.context7.com/mcp', type: 'http' }
      }
    })
    const servers = parseClaudeMcp(raw, 'claude', '/home/x/.claude.json')
    expect(servers.map((s) => [s.name, s.transport, s.detail])).toEqual([
      ['context7', 'http', 'https://mcp.context7.com/mcp'],
      ['playwright', 'stdio', 'npx -y @playwright/mcp@latest']
    ])
    expect(servers[0].id).toBe('claude:context7')
  })

  it('survives a half-written config and one with no servers', () => {
    expect(parseClaudeMcp('{ not json', 'claude', '/p')).toEqual([])
    expect(parseClaudeMcp('{"other":true}', 'claude', '/p')).toEqual([])
    expect(parseClaudeMcp('{"mcpServers":{}}', 'claude', '/p')).toEqual([])
  })
})

describe('parseCodexMcp', () => {
  it('reads [mcp_servers.*] tables, including quoted args with spaces', () => {
    const raw = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.node_repl]',
      'command = "npx"',
      'args = ["-y", "node-repl", "--flag value"]',
      '',
      '[mcp_servers.remote]',
      'url = "https://example.test/mcp"',
      '',
      '[other_section]',
      'command = "ignored"'
    ].join('\n')
    const servers = parseCodexMcp(raw, 'codex', '/home/x/.codex/config.toml')
    expect(servers.map((s) => [s.name, s.transport, s.detail])).toEqual([
      ['node_repl', 'stdio', 'npx -y node-repl --flag value'],
      ['remote', 'http', 'https://example.test/mcp']
    ])
  })

  it('returns nothing for a config with no mcp servers', () => {
    expect(parseCodexMcp('[hooks]\nfoo = "bar"\n', 'codex', '/p')).toEqual([])
  })
})

describe('inventoryMcp', () => {
  it('skips config files that do not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-mcp-'))
    expect(inventoryMcp([{ path: join(dir, 'missing.json'), agent: 'claude', format: 'json' }])).toEqual([])
  })

  it('merges both agents and sorts by id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-mcp-'))
    const claude = join(dir, '.claude.json')
    const codex = join(dir, 'config.toml')
    writeFileSync(claude, JSON.stringify({ mcpServers: { zed: { command: 'zed-mcp' } } }))
    writeFileSync(codex, '[mcp_servers.alpha]\ncommand = "alpha-mcp"\n')
    const servers = inventoryMcp([
      { path: claude, agent: 'claude', format: 'json' },
      { path: codex, agent: 'codex', format: 'toml' }
    ])
    expect(servers.map((s) => s.id)).toEqual(['claude:zed', 'codex:alpha'])
  })
})
