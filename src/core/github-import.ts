// GitHub repo import — Electron-free core service for the Server Edition.
// The Termsprawl Cloud mints a short-lived bearer clone URL for a repo the
// space owner has connected to GitHub; this module asks for it and shallow-
// clones into the server's project source root. Pure DI: fetch and the git
// spawn are injected (global fetch / execFile by default), so tests run
// without network or git. Security: the boot token and the clone URL are
// pass-through secrets — never logged, never returned to the renderer.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { basename, join } from 'node:path'

export interface GitHubImportDeps {
  /** Cloud origin, e.g. https://termsprawl.com (no trailing slash). */
  cloudApi: string
  /** Space boot token — the bearer credential for both cloud calls. */
  bootToken: string
  fetchFn?: typeof fetch
  /** Injectable git spawn returning { code, stdout, stderr }. */
  spawnFn?: (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
}

export interface ImportRequest {
  /** owner/repo (validated: no traversal, no leading slash, no spaces). */
  fullName: string
  /** Directory under which the repo folder is created. */
  destRoot: string
}

export interface ImportResult {
  /** Repo name = last path segment of fullName minus a .git suffix. */
  name: string
  /** Absolute path of the fresh clone. */
  path: string
  /** owner/repo as requested (the renderer labels nodes with it). */
  fullName: string
}

export interface SuggestedRepo {
  fullName: string
  name: string
  private: boolean
  updatedAt: string
}

/** A repo suggestion as the cloud returns it (snake_case body fields). */
interface CloudRepo {
  full_name?: unknown
  clone_url?: unknown
  private?: unknown
  updated_at?: unknown
}

const IMPORT_URL_PATH = '/api/v1/github/import-url'
const REPOS_PATH = '/api/v1/github/repos'

/** A strict owner/repo shape: word chars, dots, dashes only; exactly one '/';
 * no traversal segments, no leading/trailing slash. */
const FULL_NAME_RE = /^[\w.-]+\/[\w.-]+$/

function isValidFullName(candidate: string): boolean {
  if (!FULL_NAME_RE.test(candidate)) return false
  const [owner, repo] = candidate.split('/')
  return owner !== '.' && owner !== '..' && repo !== '.' && repo !== '..'
}

function authHeaders(bootToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bootToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Ask the cloud for a one-shot clone URL for `fullName` and shallow-clone it
 * (git clone --depth 1) into <destRoot>/<repoName>. Throws on: invalid
 * fullName, non-empty existing destination, cloud errors (404 →
 * 'github_not_connected'), or a returned URL that is not an https github.com
 * URL. Returns metadata WITHOUT the URL or any token material.
 */
export async function importGitHubRepo(deps: GitHubImportDeps, req: ImportRequest): Promise<ImportResult> {
  const fullName = String(req.fullName ?? '')
  if (!isValidFullName(fullName)) throw new Error(`invalid fullName: ${fullName}`)
  const repoName = basename(fullName).replace(/\.git$/, '')
  const dest = join(req.destRoot, repoName)

  // Destination guard: refuse to clobber a non-empty directory (an empty dir
  // is fine — git itself tolerates cloning into one).
  if (existsSync(dest)) {
    const occupied = readdirSync(dest).length > 0
    if (occupied) throw new Error(`destination exists and is not empty: ${repoName}`)
  }

  const fetchFn = deps.fetchFn ?? fetch
  const url = `${deps.cloudApi.replace(/\/+$/, '')}${IMPORT_URL_PATH}`
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.bootToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fullName }),
    })
  } catch (error) {
    throw new Error(`cloud unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (res.status === 404) throw new Error('github_not_connected')
  if (!res.ok) {
    let errText = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error) errText = body.error
    } catch {
      // non-JSON body — keep the generic status message
    }
    throw new Error(errText)
  }

  let body: { url?: unknown }
  try {
    body = (await res.json()) as { url?: unknown }
  } catch {
    throw new Error('malformed import-url response')
  }
  const cloneUrl = typeof body?.url === 'string' ? body.url : ''
  if (!isAllowedCloneUrl(cloneUrl)) {
    // Include the URL's origin only when it parses; never echo a URL that
    // could carry embedded credentials.
    throw new Error(`refusing non-github clone url: ${safeOrigin(cloneUrl)}`)
  }

  const spawnFn = deps.spawnFn ?? defaultSpawn
  const result = await spawnFn('git', ['clone', '--depth', '1', cloneUrl, dest])
  if (result.code !== 0) {
    // Redact: git stderr embeds the full (token-bearing) URL — strip it.
    const detail = String(result.stderr ?? '').split(cloneUrl).join('<clone-url>')
    throw new Error(`git clone failed: ${detail.trim() || `exit ${result.code}`}`)
  }
  return { name: repoName, path: dest, fullName }
}

/**
 * Best-effort suggestion list: fetch the connected account's repos and drop
 * the ones this space already has. NEVER throws — every failure mode
 * (network, 404 = GitHub not connected, 401 = bad auth, malformed body)
 * degrades to [] so boot stays offline-safe.
 */
export async function listSuggestedRepos(deps: GitHubImportDeps, projectNames: string[]): Promise<SuggestedRepo[]> {
  const fetchFn = deps.fetchFn ?? fetch
  const url = `${deps.cloudApi.replace(/\/+$/, '')}${REPOS_PATH}`
  let res: Response
  try {
    res = await fetchFn(url, { method: 'GET', headers: authHeaders(deps.bootToken) })
  } catch {
    return []
  }
  if (!res.ok) return []
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    return []
  }
  const list: CloudRepo[] = Array.isArray(raw) ? (raw as CloudRepo[]) : (extractReposArray(raw))
  if (!Array.isArray(list)) return []

  const taken = new Set<string>()
  for (const entry of projectNames) {
    const value = String(entry ?? '').trim()
    if (!value) continue
    taken.add(value.toLowerCase())
    // A project may be known by a cwd path or a remote URL whose LAST
    // segment is the repo name — count that as imported too.
    const last = value.split(/[\\/]/).filter(Boolean).pop() ?? ''
    if (last) taken.add(last.toLowerCase())
  }
  const out: SuggestedRepo[] = []
  for (const item of list) {
    const fullName = typeof item?.full_name === 'string' ? item.full_name : ''
    const name = fullName ? fullName.split('/').pop() ?? '' : ''
    if (!fullName || !name) continue
    if (taken.has(name.toLowerCase())) continue
    const cloneUrl = typeof item?.clone_url === 'string' ? item.clone_url : ''
    const suffix = cloneUrl.replace(/\.git$/, '').split('/').pop() ?? ''
    if (suffix && taken.has(suffix.toLowerCase())) continue
    out.push({
      fullName,
      name,
      private: item?.private === true,
      updatedAt: typeof item?.updated_at === 'string' ? item.updated_at : '',
    })
  }
  return out
}

// ---------------------------------------------------------------------------

function extractReposArray(raw: unknown): CloudRepo[] {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { repos?: unknown }).repos)) {
    return (raw as { repos: CloudRepo[] }).repos
  }
  return []
}

/** Accept only https URLs on the github.com host. */
function isAllowedCloneUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

/** Origin for error text; '' when the URL does not parse (never echoes it). */
function safeOrigin(candidate: string): string {
  try {
    return new URL(candidate).origin
  } catch {
    return ''
  }
}

function defaultSpawn(file: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFileCb(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}
