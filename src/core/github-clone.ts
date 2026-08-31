// Local GitHub clone — the desktop twin of github-import.ts. The Termsprawl
// Cloud mints a short-lived bearer clone URL; the desktop main process calls
// this (via the github:clone IPC handler) to shallow-clone the repo into a
// local projects folder. Pure DI: the git spawn is injected (execFile by
// default), so tests run without network or git. Security: the URL carries
// the GitHub credential — it is validated before use, never logged, never
// returned to the renderer, and redacted out of any git stderr that surfaces
// in an error message.
import { existsSync, readdirSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'

export interface GitHubCloneDeps {
  /** Injectable git spawn returning { code, stdout, stderr }. */
  spawnFn?: (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
}

export interface CloneRequest {
  /** The credential-bearing https github.com clone URL from the cloud. */
  url: string
  /** Absolute destination directory for the clone. */
  dest: string
}

export interface CloneResult {
  /** Absolute path of the fresh clone. */
  path: string
  ok: true
}

/** Accept only https URLs on the github.com host — the URL carries a
 * credential, so anything else (http, another host, scp-style, file://) is
 * refused before git ever runs. */
function isAllowedCloneUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

/**
 * Shallow-clone `req.url` (git clone --depth 1) into `req.dest`. Throws on:
 * a non-github.com https URL, a non-empty existing destination, or a failed
 * git run — with the URL redacted from the stderr. Returns the clone path.
 */
export async function cloneRepo(deps: GitHubCloneDeps, req: CloneRequest): Promise<CloneResult> {
  const url = String(req.url ?? '')
  if (!isAllowedCloneUrl(url)) {
    // Never echo the URL itself — include only its origin when it parses.
    let origin = ''
    try {
      origin = new URL(url).origin
    } catch {
      origin = ''
    }
    throw new Error(`refusing non-github clone url: ${origin}`)
  }

  // Destination guard: refuse to clobber a non-empty directory (an empty dir
  // is fine — git itself tolerates cloning into one).
  if (existsSync(req.dest)) {
    const occupied = readdirSync(req.dest).length > 0
    if (occupied) throw new Error(`destination exists and is not empty: ${req.dest}`)
  }

  const spawnFn = deps.spawnFn ?? defaultSpawn
  const result = await spawnFn('git', ['clone', '--depth', '1', url, req.dest])
  if (result.code !== 0) {
    // Redact: git stderr embeds the full (token-bearing) URL — strip it.
    const detail = String(result.stderr ?? '').split(url).join('<clone-url>')
    throw new Error(`git clone failed: ${detail.trim() || `exit ${result.code}`}`)
  }
  return { path: req.dest, ok: true }
}

function defaultSpawn(file: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFileCb(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}
