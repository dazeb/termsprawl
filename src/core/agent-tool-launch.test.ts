import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { prepareToolLaunch, selectLaunchAdapter, shellQuote } from './agent-tool-launch'
import { externalTerminalCommand } from './agent-tool-external'
import { TOOL_GUIDES } from './agent-tools'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('agent launch adapters', () => {
  it('requires evidence from the actual executable', () => {
    expect(selectLaunchAdapter({ executable: '/bin/claude', help: '--mcp-config --append-system-prompt', version: '1' }).kind).toBe('claude-mcp')
    expect(selectLaunchAdapter({ executable: '/bin/agy', help: '--prompt-interactive', version: '1' })).toMatchObject({ nativeMcp: false, instructionFlag: '--prompt-interactive' })
    expect(selectLaunchAdapter({ executable: '/bin/openclaude', help: '', version: '1' }).kind).toContain('unverified')
    expect(selectLaunchAdapter({ executable: '/bin/other', help: '--mcp-config --append-system-prompt', version: '1' }).nativeMcp).toBe(false)
  })
  it('quotes paths and prompt content as literal shell arguments', () => {
    const value = "spaces 'quotes' $(touch /tmp/never-run-agent-tool) `false` $HOME\nnext"
    expect(execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' })).toBe(value)
  })
  it('supplies the same dedicated Termsprawl prompt to supported launches and MCP guides', () => {
    const directory = mkdtempSync(join(tmpdir(), 'launch prompt ')); roots.push(directory)
    for (const probe of [
      { executable: '/bin/claude', help: '--mcp-config --append-system-prompt', version: '1' },
      { executable: '/bin/gemini', help: '--prompt-interactive', version: '1' },
      { executable: '/bin/codex', help: '--config mcp', version: '1' }
    ]) {
      const launch = prepareToolLaunch({ probe, commandTail: '', directory, sessionFile: join(directory, 'session.json'), launcher: join(directory, 'termsprawlctl') })
      const promptFile = join(directory, 'termsprawl-system.md')
      expect(launch.env.TERMSPRAWL_SYSTEM_PROMPT_FILE).toBe(promptFile)
      const source = readFileSync(join(__dirname, 'prompts/termsprawl-system.md'), 'utf8').trim()
      expect(readFileSync(promptFile, 'utf8').trim()).toBe(source)
      expect(statSync(promptFile).mode & 0o777).toBe(0o600)
      expect(TOOL_GUIDES.overview).toBe(source)
      expect(source).toContain('agent_reply')
      if (probe.executable !== '/bin/codex') expect(launch.command).toContain(shellQuote(source))
    }
  })
  it('generates repeatable per-launch config and focused skills without credentials in instructions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'launch agent ')); roots.push(directory)
    const input = { probe: { executable: '/bin/claude', help: '--mcp-config --append-system-prompt', version: '1' }, commandTail: ' --session-id n1', directory, sessionFile: join(directory, 'session.json'), launcher: join(directory, 'termsprawlctl') }
    const first = prepareToolLaunch(input)
    expect(prepareToolLaunch(input)).toEqual(first)
    const config = JSON.parse(readFileSync(join(directory, 'mcp.json'), 'utf8'))
    expect(config.mcpServers.termsprawl.args).toEqual(['--session', input.sessionFile, 'mcp'])
    expect(first.command).not.toContain('--strict-mcp-config')
    expect(first.command).not.toContain('--dangerously')
    expect(readFileSync(join(directory, 'skills/termsprawl-terminal/SKILL.md'), 'utf8')).toContain('terminal_external')
    const codex = prepareToolLaunch({ ...input, probe: { executable: '/bin/codex', help: '--config mcp', version: '1' } })
    expect(codex.command).toContain('mcp_servers.termsprawl.command')
    expect(codex.command).not.toContain('developer_instructions')
  })
})

describe('external terminal attachment', () => {
  const tmux = { tmuxPath: '/usr/bin/tmux', socketPath: '/tmp/socket with spaces', configPath: '/tmp/config', baseArgs: ['-S', '/tmp/socket with spaces'] }
  it('attaches an additional tmux client without detaching existing clients', () => {
    const command = externalTerminalCommand(tmux, 'n1', undefined, (name) => name === 'kitty' ? '/usr/bin/kitty' : null)
    expect(command.args).toEqual(['--', '/usr/bin/tmux', '-S', '/tmp/socket with spaces', 'attach-session', '-t', 'ts-n1'])
    expect(command.args).not.toContain('-d')
    expect(command.args).not.toContain('-D')
  })
  it('supports an argument template without invoking a shell', () => {
    expect(externalTerminalCommand(tmux, 'n1', { executable: '/opt/terminal app', args: ['--title', 'agent', '--', '{command}'] }, name => name).args).toContain('/tmp/socket with spaces')
    expect(() => externalTerminalCommand(tmux, 'n1', { executable: 'x', args: ['-e'] })).toThrow('placeholder')
    expect(() => externalTerminalCommand(tmux, 'n1', undefined, () => null)).toThrow('canvas terminal is still available')
  })
})
