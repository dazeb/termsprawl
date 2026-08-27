// Phase 9 — SSH remote transport primitive. Electron-free. argv-array spawns
// only (never a shell string on the local side); `ssh` passes command args to
// the remote shell, which is where any compound command runs. The remote note
// is the transport seam: remote PTY/git/file ops all run through runSsh.

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

/** Extra ssh options threaded through the transport (Phase 9 ControlMaster). */
export interface SshOptions {
  /** ControlMaster socket path. When set, ssh multiplexes onto one persistent
   * connection per socket — repeated git/file ops over a WAN stop paying the
   * TCP+auth handshake every call. `ControlMaster=auto` creates the master on
   * first use; `ControlPersist=600` keeps it alive 10 min after the last
   * client detaches. Interactive terminals deliberately do NOT pass this
   * (they own a dedicated connection). */
  controlPath?: string
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
export function connectionArgs(remote: RemoteHost, opts?: SshOptions): string[] {
  const target = remote.user ? `${remote.user}@${remote.host}` : remote.host
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']
  if (opts?.controlPath) {
    args.push(
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${opts.controlPath}`,
      '-o',
      'ControlPersist=600'
    )
  }
  if (remote.port) args.push('-p', String(remote.port))
  args.push(target)
  return args
}

/** Stable per-host ControlMaster socket path under the app data dir. Host,
 * user, and port are sanitized into the filename (slashes/colons would break
 * ControlPath). Ensures the `ssh/` dir exists. */
export function sshControlPath(userDataPath: string, remote: RemoteHost): string {
  const label = `${remote.user ?? 'root'}@${remote.host}${remote.port ? `:${remote.port}` : ''}`
  const safe = label.replace(/[^A-Za-z0-9_.@-]/g, '_')
  const dir = join(userDataPath, 'ssh')
  mkdirSync(dir, { recursive: true })
  return join(dir, `ctl-${safe}`)
}

/** True when two remote destinations are the same host/user/port. Path is
 * deliberately NOT compared (a project's git root may differ from its cwd). */
export function sameRemoteHost(a: RemoteHost, b: RemoteHost): boolean {
  return a.host === b.host && (a.user ?? 'root') === (b.user ?? 'root') && (a.port ?? 22) === (b.port ?? 22)
}

/** Run `ssh <remote> <command...>` and capture the result. argv-array on the
 * local side (no local shell); each element is quoted for the remote shell.
 */
export function runSsh(remote: RemoteHost, command: string[], opts?: SshOptions): Promise<SshResult> {
  return runSshRaw(remote, remoteCommand(command), opts)
}

/** Run a pre-quoted remote shell command string (single argv element, passed
 * through untouched — the caller owns quoting, e.g. `remoteSh`). */
export function runSshRaw(remote: RemoteHost, commandStr: string, opts?: SshOptions): Promise<SshResult> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...connectionArgs(remote, opts), commandStr], {
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

/** Like `runSshRaw`, but pipes `input` to the remote command's stdin. Used by
 * remote file write (`cat > <path>`). Closes stdin after writing. */
export function runSshWithInput(
  remote: RemoteHost,
  commandStr: string,
  input: string,
  opts?: SshOptions
): Promise<SshResult> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...connectionArgs(remote, opts), commandStr], {
      stdio: ['pipe', 'pipe', 'pipe']
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
    child.stdin.end(input)
  })
}

/** Single-quote a value for a POSIX remote shell (safe against spaces and
 * embedded quotes). The remote command string is parsed by the remote shell,
 * so every dynamic value must be quoted — unquoted, a commit message or path
 * containing spaces would be split into separate words. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Serialize a command argv into ONE remote-shell command string. ssh joins
 * argv elements with spaces and hands the joined string to the remote shell,
 * so each element must be single-quoted — otherwise any argument containing
 * spaces (commit messages, paths) is misparsed as multiple words. Callers
 * that build their own pre-quoted compound command must use `runSshRaw`. */
export function remoteCommand(command: string[]): string {
  return command.map(shq).join(' ')
}
