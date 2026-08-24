// Phase 9 — remote file ops over ssh. The local side never runs a shell
// (argv-array to ssh); the remote `sh -c` runs a command we build ourselves
// with every dynamic value fully single-quoted. Electron-free.
import { runSsh, type RemoteHost, type SshResult } from './ssh'

/** Single-quote a value for a POSIX remote shell. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Build the remote `cat <path>` command (path fully quoted). */
export function remoteFileReadCmd(path: string): string {
  return `cat ${shq(path)}`
}

export interface RemoteFileResult {
  ok: boolean
  content?: string
  error?: string
}

/** Run a fully-quoted compound command on the remote shell. ssh joins argv into
 * one command string, so the remote command must be a single argv element — an
 * `sh -c` wrapper here would stringify to `sh -c <script> <arg>`, making the
 * remote run `<script>` with `<arg>` as `$0` instead of the intended command. */
export function remoteSh(remote: RemoteHost, cmd: string): Promise<SshResult> {
  return runSsh(remote, [cmd])
}

/** Read a file's content over ssh. */
export async function remoteFileRead(
  remote: RemoteHost,
  path: string
): Promise<RemoteFileResult> {
  const r = await remoteSh(remote, remoteFileReadCmd(path))
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `ssh exited ${r.code}` }
  return { ok: true, content: r.stdout }
}
