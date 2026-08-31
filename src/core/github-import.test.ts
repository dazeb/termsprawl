// Tests for the GitHub repo import core service. fetch and the git spawn are
// injected (fetchFn/spawnFn) so tests never touch the network or real git.
// Contract: the cloud mints a short-lived bearer clone URL; the token and the
// URL must never leak into results, errors, or spawn-arg assertions beyond
// the deliberate pass-through to git itself.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importGitHubRepo, listSuggestedRepos } from './github-import'

const CLOUD = 'http://cloud.test'

let destRoot: string

beforeEach(() => {
  destRoot = mkdtempSync(join(tmpdir(), 'ts-ghimport-'))
})

afterEach(() => {
  rmSync(destRoot, { recursive: true, force: true })
})

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type FetchCall = { url: string; init?: RequestInit }

function makeDeps(opts: {
  fetchStatus?: number
  fetchBody?: unknown
  fetchUrl?: string
  spawnCode?: number
  spawnStderr?: string
} = {}) {
  const fetchCalls: FetchCall[] = []
  const spawnCalls: Array<{ file: string; args: string[] }> = []
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init })
    const body = opts.fetchBody ?? { url: opts.fetchUrl ?? 'https://github.com/owner/repo.git' }
    return jsonResponse(body, opts.fetchStatus ?? 200)
  })
  const spawnFn = vi.fn(async (file: string, args: string[]) => {
    spawnCalls.push({ file, args })
    return { code: opts.spawnCode ?? 0, stderr: opts.spawnStderr ?? '', stdout: '' }
  })
  const deps = { cloudApi: CLOUD, bootToken: 'boot-tok', fetchFn, spawnFn }
  return { deps, fetchCalls, spawnCalls, fetchFn, spawnFn }
}

describe('importGitHubRepo', () => {
  it('happy path: POSTs import-url with bearer auth, shallow-clones into destRoot/<name>, returns metadata without the url', async () => {
    const tokenUrl = 'https://x-access-token:secret@github.com/owner/repo.git'
    const { deps, fetchCalls, spawnCalls } = makeDeps({ fetchUrl: tokenUrl })
    const dest = join(destRoot, 'repo')

    const result = await importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe(`${CLOUD}/api/v1/github/import-url`)
    expect((fetchCalls[0].init?.method ?? '').toUpperCase()).toBe('POST')
    const headers = fetchCalls[0].init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer boot-tok')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ fullName: 'owner/repo' })

    expect(spawnCalls).toEqual([{ file: 'git', args: ['clone', '--depth', '1', tokenUrl, dest] }])
    expect(result).toEqual({ name: 'repo', path: dest, fullName: 'owner/repo' })
    // The renderer-facing result must never carry the token or the clone URL.
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('github.com')
  })

  it('derives the repo name from a .git-suffixed fullName', async () => {
    const { deps, spawnCalls } = makeDeps({ fetchUrl: 'https://github.com/owner/my.lib.git' })
    const result = await importGitHubRepo(deps, { fullName: 'owner/my.lib.git', destRoot })
    expect(result.name).toBe('my.lib')
    expect(spawnCalls[0].args[4]).toBe(join(destRoot, 'my.lib'))
  })

  it('404 maps to github_not_connected', async () => {
    const { deps, spawnCalls } = makeDeps({ fetchStatus: 404, fetchBody: { error: 'github_not_connected' } })
    await expect(importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })).rejects.toThrow('github_not_connected')
    expect(spawnCalls).toHaveLength(0)
  })

  it('other non-200 responses throw with the body error string', async () => {
    const { deps } = makeDeps({ fetchStatus: 500, fetchBody: { error: 'cloud on fire' } })
    await expect(importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })).rejects.toThrow('cloud on fire')
  })

  it('refuses malformed fullNames before any network call', async () => {
    for (const bad of ['', 'owner', '/abs/repo', '../escape', 'owner/../..', 'has space/repo', 'owner/repo/x', '..']) {
      const { deps, fetchCalls, spawnCalls } = makeDeps()
      await expect(importGitHubRepo(deps, { fullName: bad, destRoot })).rejects.toThrow(/invalid fullName/i)
      expect(fetchCalls).toHaveLength(0)
      expect(spawnCalls).toHaveLength(0)
    }
  })

  it('refuses a non-empty existing destination directory before any network call', async () => {
    mkdirSync(join(destRoot, 'repo'), { recursive: true })
    writeFileSync(join(destRoot, 'repo', 'keep.txt'), 'x')
    const { deps, fetchCalls, spawnCalls } = makeDeps()
    await expect(importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })).rejects.toThrow(/not empty/i)
    expect(fetchCalls).toHaveLength(0)
    expect(spawnCalls).toHaveLength(0)
  })

  it('allows an existing but EMPTY destination directory', async () => {
    mkdirSync(join(destRoot, 'repo'), { recursive: true })
    const { deps } = makeDeps()
    const result = await importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })
    expect(result.path).toBe(join(destRoot, 'repo'))
  })

  it('refuses a returned clone url that is not https github.com', async () => {
    for (const bad of ['http://github.com/owner/repo.git', 'https://evil.test/owner/repo.git', 'file:///tmp/x', 'not a url']) {
      const { deps, spawnCalls } = makeDeps({ fetchUrl: bad })
      await expect(importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })).rejects.toThrow(/clone url/i)
      expect(spawnCalls).toHaveLength(0)
    }
  })

  it('clone failure throws with a REDACTED stderr (no url, no token)', async () => {
    const tokenUrl = 'https://x-access-token:secret@github.com/owner/repo.git'
    const { deps } = makeDeps({
      fetchUrl: tokenUrl,
      spawnCode: 128,
      spawnStderr: `fatal: unable to access '${tokenUrl}': The requested URL returned error: 403`,
    })
    await expect(importGitHubRepo(deps, { fullName: 'owner/repo', destRoot })).rejects.toThrow(
      /git clone failed: fatal: unable to access '<clone-url>'/
    )
  })
})

describe('listSuggestedRepos', () => {
  it('GETs /github/repos with bearer auth and filters already-imported repos (by name and by path suffix)', async () => {
    const { deps, fetchCalls } = makeDeps({
      fetchBody: {
        repos: [
          { full_name: 'me/alpha', clone_url: 'https://github.com/me/alpha.git', private: false, updated_at: '2026-01-02T03:04:05Z' },
          { full_name: 'me/bravo', clone_url: 'https://github.com/me/bravo.git', private: true, updated_at: '2026-02-03T04:05:06Z' },
          { full_name: 'me/gamma', clone_url: 'https://github.com/me/gamma.git', private: false, updated_at: '2026-03-04T05:06:07Z' },
        ],
      },
    })

    const repos = await listSuggestedRepos(deps, ['alpha', '/home/u/src/me/gamma'])

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe(`${CLOUD}/api/v1/github/repos`)
    expect((fetchCalls[0].init?.method ?? '').toUpperCase()).toBe('GET')
    const headers = fetchCalls[0].init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer boot-tok')
    expect(repos).toEqual([
      { fullName: 'me/bravo', name: 'bravo', private: true, updatedAt: '2026-02-03T04:05:06Z' },
    ])
  })

  it('filters case-insensitively and accepts a bare JSON array body', async () => {
    const { deps } = makeDeps({
      fetchBody: [{ full_name: 'me/Alpha', clone_url: 'https://github.com/me/Alpha.git', private: false, updated_at: 'z' }],
    })
    const repos = await listSuggestedRepos(deps, ['alpha'])
    expect(repos).toEqual([])
  })

  it('matches the clone_url suffix against project names', async () => {
    const { deps } = makeDeps({
      fetchBody: {
        repos: [
          { full_name: 'me/delta', clone_url: 'https://github.com/me/delta.git', private: false, updated_at: 'z' },
        ],
      },
    })
    const repos = await listSuggestedRepos(deps, ['My Checkout', 'https://github.com/me/delta'])
    expect(repos).toEqual([])
  })

  it('404 and 401 degrade to [] (best-effort, never throws)', async () => {
    for (const status of [404, 401]) {
      const { deps } = makeDeps({ fetchStatus: status, fetchBody: { error: 'nope' } })
      await expect(listSuggestedRepos(deps, ['alpha'])).resolves.toEqual([])
    }
  })
})
