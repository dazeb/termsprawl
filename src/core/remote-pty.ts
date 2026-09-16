// Phase 9 — remote terminal transport over ssh `-tt` + remote tmux. A local
// node-pty runs `ssh -tt <host> tmux new-session ...`, which allocates a PTY on
// the remote host and multiplexes it through tmux, so terminals survive app
// restarts the same way local sessions do. Electron-free.
import { spawnSync } from 'node:child_process'
import { runSsh, connectionArgs, remoteCommand, type RemoteHost } from './ssh'
import { shq } from './remote-file'

/** Build the argv for `ssh -tt <remote> tmux ...` that creates/attaches a tmux
 * session on the remote host. `ssh` joins argv into one command string, so the
 * tmux compound command is a single argv element (leading `-tt` allocates the
 * remote PTY; `-c <dir>` sets the remote shell's working directory). */
export function remoteTmuxSpawnArgv(
  remote: RemoteHost,
  sessionName: string,
  shell: string,
  remoteCwd?: string,
  launch?: string
): string[] {
  const base = connectionArgs(remote) // ends with the target
  const target = base[base.length - 1] ?? remote.host
  const opts = base.slice(0, -1)
  const cwdArg = remoteCwd ? ` -c ${shq(remoteCwd)}` : ''
  const paneCommand = launch ? `${shq(shell)} -lc ${shq(launch)}` : shq(shell)
  const tmuxCmd = `tmux new-session -A -D -s ${sessionName}${cwdArg} -- ${paneCommand}`
  return ['-tt', ...opts, target, tmuxCmd]
}

/** True when a tmux session with this name already exists on the remote host. */
export async function remoteTmuxHasSession(
  remote: RemoteHost,
  sessionName: string
): Promise<boolean> {
  const r = await runSsh(remote, ['tmux', 'has-session', '-t', sessionName])
  return r.code === 0
}

/** Sync fresh-check (for the sync create() path): spawnSync, status only. */
export function remoteTmuxHasSessionSync(
  remote: RemoteHost,
  sessionName: string
): boolean {
  try {
    return (
      spawnSync('ssh', [...connectionArgs(remote), remoteCommand(['tmux', 'has-session', '-t', sessionName])], {
        stdio: 'ignore'
      }).status === 0
    )
  } catch {
    return false
  }
}

/** Kill a tmux session on the remote host (idempotent). */
export async function remoteTmuxKillSession(
  remote: RemoteHost,
  sessionName: string
): Promise<void> {
  await runSsh(remote, ['tmux', 'kill-session', '-t', sessionName])
}

/** Capture the remote pane's recent output (`tmux capture-pane -p -S -200`).
 * Returns null when the session is gone. Used by the Telegram bot's peek/attach. */
export async function remoteTmuxCapture(
  remote: RemoteHost,
  sessionName: string
): Promise<string | null> {
  const r = await runSsh(remote, ['tmux', 'capture-pane', '-p', '-S', '-200', '-t', sessionName])
  return r.code === 0 ? r.stdout : null
}

/** Sync remote capture (the bot's peek/attach runs in a sync loop). */
export function remoteTmuxCaptureSync(remote: RemoteHost, sessionName: string): string | null {
  try {
    const r = spawnSync(
      'ssh',
      [...connectionArgs(remote), remoteCommand(['tmux', 'capture-pane', '-p', '-S', '-200', '-t', sessionName])],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return r.status === 0 ? (r.stdout ?? null) : null
  } catch {
    return null
  }
}

/** Sync remote kill (for the sync destroy path). */
export function remoteTmuxKillSessionSync(remote: RemoteHost, sessionName: string): void {
  try {
    spawnSync('ssh', [...connectionArgs(remote), remoteCommand(['tmux', 'kill-session', '-t', sessionName])], {
      stdio: 'ignore'
    })
  } catch {
    // idempotent
  }
}
