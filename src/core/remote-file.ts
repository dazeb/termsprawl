// Phase 9 — remote file ops over ssh. The local side never runs a shell
// (argv-array to ssh); the remote `sh -c` runs a command we build ourselves
// with every dynamic value fully single-quoted. Electron-free.
import { posix } from 'node:path'
import { runSshRaw, runSshWithInput, shq, type RemoteHost, type SshOptions, type SshResult } from './ssh'
import type { DirEntry, DirEntryKind, DirListResult } from '../shared/types'

export { shq }

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
export function remoteSh(remote: RemoteHost, cmd: string, opts?: SshOptions): Promise<SshResult> {
  return runSshRaw(remote, cmd, opts)
}

/** Read a file's content over ssh. */
export async function remoteFileRead(
  remote: RemoteHost,
  path: string,
  opts?: SshOptions
): Promise<RemoteFileResult> {
  const r = await remoteSh(remote, remoteFileReadCmd(path), opts)
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `ssh exited ${r.code}` }
  return { ok: true, content: r.stdout }
}

/**
 * Remote directory listing mirroring `listProjectDir` semantics: one level,
 * dotfiles + node_modules + .git skipped, dirs first then name. Uses GNU
 * `find -printf` on the remote (Debian/Ubuntu hosts have it). The command
 * emits `MISSING` / `NOTDIR` markers on stderr so the result can distinguish.
 */
export function remoteListDirCmd(path: string): string {
  const p = shq(path)
  return (
    `if [ ! -e ${p} ]; then echo MISSING >&2; exit 1; fi; ` +
    `if [ ! -d ${p} ]; then echo NOTDIR >&2; exit 2; fi; ` +
    `find ${p} -maxdepth 1 -mindepth 1 -printf '%y\\t%f\\n'`
  )
}

const REMOTE_SKIP = new Set(['node_modules', '.git'])

function skipRemoteEntry(name: string): boolean {
  return name.startsWith('.') || REMOTE_SKIP.has(name)
}

/** Parse `find -printf '%y\t%f\n'` output into entries rooted at `path`. */
export function parseRemoteDirListing(stdout: string, path: string): DirEntry[] {
  const entries: DirEntry[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const kindChar = line[0]
    const name = line.slice(tab + 1)
    if (!name || skipRemoteEntry(name)) continue
    const kind: DirEntryKind = kindChar === 'd' ? 'dir' : 'file'
    entries.push({ name, path: posix.join(path, name), kind })
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

/** List one remote folder (mirror listProjectDir). Never walks outside `path`. */
export async function remoteListDir(
  remote: RemoteHost,
  path: string,
  opts?: SshOptions
): Promise<DirListResult> {
  const r = await remoteSh(remote, remoteListDirCmd(path), opts)
  const marker = r.stderr.trim()
  if (r.code !== 0) {
    if (marker === 'MISSING') return { error: { code: 'MISSING', message: 'folder not found' } }
    if (marker === 'NOTDIR') return { error: { code: 'IO', message: 'path is not a folder' } }
    return { error: { code: 'IO', message: marker || `ssh exited ${r.code}` } }
  }
  return { entries: parseRemoteDirListing(r.stdout, path) }
}

/** Write file content over ssh via `mkdir -p <dir> && cat > <path>` with the
 * content piped on stdin (no shell quoting of the content — safe for any text). */
export async function remoteFileWrite(
  remote: RemoteHost,
  path: string,
  content: string,
  opts?: SshOptions
): Promise<RemoteFileResult> {
  const cmd = `mkdir -p ${shq(posix.dirname(path))} && cat > ${shq(path)}`
  const r = await runSshWithInput(remote, cmd, content, opts)
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `ssh exited ${r.code}` }
  return { ok: true }
}
