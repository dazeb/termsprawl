// Phase 9 — SSH remote transport primitive. Electron-free. argv-array spawns
// only (never a shell string on the local side); `ssh` passes command args to
// the remote shell, which is where any compound command runs. The remote note
// is the transport seam: remote PTY/git/file ops all run through runSsh.

import { spawn } from 'node:child_process'

export interface RemoteHost {
  host: string
  user?: string
  port?: number
}

export interface SshResult {
  code: number
  stdout: string
  stderr: string
}

/** Parse an ssh destination. Accepts `host`, `user@host`, `user@host:port`.
 * A trailing non-numeric `:segment` (scp-style `host:path`) is kept on the host
 * (no port) rather than mistook for a port. */
export function parseRemote(remote: string): RemoteHost {
  let rest = remote.trim()
  let user: string | undefined
  const at = rest.indexOf('@')
  if (at !== -1) {
    user = rest.slice(0, at)
    rest = rest.slice(at + 1)
  }
  let port: number | undefined
  const colon = rest.lastIndexOf(':')
  if (colon !== -1 && /^\d+$/.test(rest.slice(colon + 1))) {
    port = Number(rest.slice(colon + 1))
    rest = rest.slice(0, colon)
  }
  return {
    host: rest,
    ...(user ? { user } : {}),
    ...(port !== undefined ? { port } : {})
  }
}

/** Build the argv for `ssh` (before the remote command). Non-interactive. */
export function connectionArgs(remote: RemoteHost): string[] {
  const target = remote.user ? `${remote.user}@${remote.host}` : remote.host
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']
  if (remote.port) args.push('-p', String(remote.port))
  args.push(target)
  return args
}

/** Run `ssh <remote> <command...>` and capture the result. argv-array, no shell
 * on the local side. */
export function runSsh(remote: RemoteHost, command: string[]): Promise<SshResult> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...connectionArgs(remote), ...command], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}
