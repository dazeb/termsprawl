import { spawn } from 'node:child_process'
import { findExecutable } from './command-resolver'
import type { TmuxConfig } from './tmux'
import { sessionNameFor } from './tmux'

export interface ExternalTerminalConfig { executable: string; args: string[] }
export function externalTerminalCommand(tmux: TmuxConfig, nodeId: string, config?: ExternalTerminalConfig, find = findExecutable): { executable: string; args: string[] } {
  const attach = [tmux.tmuxPath, ...tmux.baseArgs, 'attach-session', '-t', sessionNameFor(nodeId)]
  if (config) {
    if (!config.executable || !Array.isArray(config.args) || !config.args.every((a) => typeof a === 'string') || config.args.filter((a) => a === '{command}').length !== 1) throw new Error('External terminal args must contain exactly one {command} placeholder')
    const executable = find(config.executable)
    if (!executable) throw new Error('Configured external terminal executable was not found')
    return { executable, args: config.args.flatMap((arg) => arg === '{command}' ? attach : [arg]) }
  }
  for (const [name, prefix] of [['x-terminal-emulator', ['-e']], ['kitty', ['--']], ['alacritty', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']], ['xterm', ['-e']]] as const) {
    const executable = find(name)
    if (executable) return { executable, args: [...prefix, ...attach] }
  }
  throw new Error('No supported Linux terminal emulator found. Install one or configure agent-tools/preferences.json. The canvas terminal is still available.')
}

export async function launchExternalTerminal(command: { executable: string; args: string[] }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env }
    delete env.TMUX
    delete env.TMUX_PANE
    const child = spawn(command.executable, command.args, { detached: true, stdio: 'ignore', env })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}
