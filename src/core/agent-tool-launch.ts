import { execFileSync } from 'node:child_process'
import { accessSync, constants, chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { findExecutable } from './command-resolver'
import { TOOL_GUIDES, type IntegrationStatus } from './agent-tools'

export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'` }

export interface AgentProbe { executable: string; help: string; version: string }
export function clearAgentProbeCache(): void { probeCache.clear() }
const probeCache = new Map<string, AgentProbe>()
export function probeAgent(command: string): AgentProbe | null {
  const executable = findExecutable(command)
  if (!executable) return null
  try { accessSync(executable, constants.X_OK); if (!statSync(executable).isFile()) return null } catch { return null }
  if (probeCache.has(executable)) return probeCache.get(executable)!
  const read = (flag: string): string => {
    try { return execFileSync(executable, [flag], { encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
  }
  const probe = { executable, help: read('--help'), version: read('--version').slice(0, 160) || 'unknown' }
  probeCache.set(executable, probe)
  return probe
}

export interface LaunchAdapter { kind: string; nativeMcp: boolean; instructionFlag?: string; initialPrompt?: boolean }

/** Select by executable AND its own help. A preset name alone is insufficient. */
export function selectLaunchAdapter(probe: AgentProbe): LaunchAdapter {
  const name = basename(probe.executable)
  if (name === 'claude' && probe.help.includes('--mcp-config') && probe.help.includes('--append-system-prompt')) return { kind: 'claude-mcp', nativeMcp: true, instructionFlag: '--append-system-prompt' }
  if (name === 'codex' && probe.help.includes('--config') && /mcp/.test(probe.help)) return { kind: 'codex-mcp', nativeMcp: true }
  if (name === 'opencode' && /--prompt\b/.test(probe.help)) return { kind: 'opencode-cli', nativeMcp: false, instructionFlag: '--prompt' }
  if (['agy', 'antigravity', 'gemini'].includes(name) && probe.help.includes('--prompt-interactive')) return { kind: `${name}-cli`, nativeMcp: false, instructionFlag: '--prompt-interactive' }
  // Only advertise an instruction route explicitly described by this binary.
  if (['gemini', 'agy', 'antigravity', 'grok', 'openclaude'].includes(name) && /\[PROMPT\]|\[prompt\]/.test(probe.help)) return { kind: `${name}-cli`, nativeMcp: false, initialPrompt: true }
  return { kind: `${name}-unverified`, nativeMcp: false }
}

export function installToolRuntime(directory: string, executable: string, bundle: string): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const runtime = join(directory, 'client.mjs')
  writeFileSync(runtime, readFileSync(bundle), { mode: 0o600 })
  const launcher = join(directory, 'termsprawlctl')
  writeFileSync(launcher, `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 ${shellQuote(executable)} ${shellQuote(runtime)} "$@"\n`, { mode: 0o700 })
  chmodSync(launcher, 0o700)
  return launcher
}

export function prepareToolLaunch(options: {
  probe: AgentProbe; commandTail: string; directory: string; sessionFile: string; launcher: string
  customInstructionFlag?: string
}): { command: string; env: Record<string, string>; status: IntegrationStatus } {
  const { probe, commandTail, directory, sessionFile, launcher } = options
  const adapter = selectLaunchAdapter(probe)
  if (options.customInstructionFlag && /^--[a-z][a-z-]*$/.test(options.customInstructionFlag)) adapter.instructionFlag = options.customInstructionFlag
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const orientation = `${TOOL_GUIDES.overview}\nYour helper is ${launcher}. Workflow guides are available through guide_read.`
  for (const [topic, body] of Object.entries(TOOL_GUIDES)) {
    const folder = join(directory, 'skills', `termsprawl-${topic}`)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: termsprawl-${topic}\ndescription: Use termsprawl ${topic} tools and workflows.\n---\n\n${body}\n`, { mode: 0o600 })
  }
  const args: string[] = []
  if (adapter.kind === 'claude-mcp') {
    const config = join(directory, 'mcp.json')
    writeFileSync(config, JSON.stringify({ mcpServers: { termsprawl: { command: launcher, args: ['--session', sessionFile, 'mcp'] } } }), { mode: 0o600 })
    args.push('--mcp-config', config)
  } else if (adapter.kind === 'codex-mcp') {
    // All fields belong to our own server. Existing instructions/accounts and other MCP servers remain intact.
    args.push('-c', `mcp_servers.termsprawl.command=${JSON.stringify(launcher)}`, '-c', `mcp_servers.termsprawl.args=${JSON.stringify(['--session', sessionFile, 'mcp'])}`)
  }
  if (adapter.instructionFlag) args.push(adapter.instructionFlag, orientation)
  else if (adapter.initialPrompt) args.push(orientation)
  const available = adapter.nativeMcp || adapter.instructionFlag || adapter.initialPrompt
  return {
    command: `${shellQuote(probe.executable)}${commandTail}${args.length ? ' ' + args.map(shellQuote).join(' ') : ''}`,
    env: { TERMSPRAWL_SESSION_FILE: sessionFile, TERMSPRAWL_CTL: launcher },
    status: { state: available && !adapter.nativeMcp ? 'cli-fallback' : 'needs-setup', adapter: adapter.kind, version: probe.version,
      reason: adapter.nativeMcp ? 'Waiting for the agent to connect to MCP' : available ? 'Instructions supplied; shell tool access is subject to agent permissions' : 'Instruction delivery is unverified. Read the generated skills and configure this agent explicitly.' }
  }
}
