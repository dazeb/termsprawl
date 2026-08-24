// Phase 9 — remote terminal transport over ssh `-tt` + remote tmux. A local
// node-pty runs `ssh -tt <host> tmux new-session ...`, which allocates a PTY on
// the remote host and multiplexes it through tmux, so terminals survive app
// restarts the same way local sessions do. Electron-free.
import { runSsh, connectionArgs, type RemoteHost } from './ssh'

/**
 * Build the argv for `ssh -tt <remote> tmux ...` that creates/attaches a tmux
 * session on the remote host. `ssh` joins argv into one command string, so the
 * tmux compound command is a single argv element (leading `-tt` allocates the
 * remote PTY). `sessionName` is the stable `ts-<nodeId>` key; `shell` is the
 * remote shell to start (a simple path, no spaces).
 */
export function remoteTmuxSpawnArgv(
  remote: RemoteHost,
  sessionName: string,
  shell: string
): string[] {
  const base = connectionArgs(remote) // ends with the target
  const target = base[base.length - 1] ?? remote.host
  const opts = base.slice(0, -1)
  const tmuxCmd = `tmux new-session -A -D -s ${sessionName} -- ${shell}`
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

/** Kill a tmux session on the remote host (idempotent). */
export async function remoteTmuxKillSession(
  remote: RemoteHost,
  sessionName: string
): Promise<void> {
  await runSsh(remote, ['tmux', 'kill-session', '-t', sessionName])
}
