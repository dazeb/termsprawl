// Tests for the LOCAL clone helper (the desktop twin of github-import.ts).
// The git spawn is injected (spawnFn) so tests never touch network or git.
// Contract: the url is a credential-bearing bearer URL minted by the cloud —
// it is validated before use, never echoed in an error, and redacted out of
// any git stderr the caller sees.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneRepo } from './github-clone'

let destRoot: string

beforeEach(() => {
  destRoot = mkdtempSync(join(tmpdir(), 'ts-ghclone-'))
})

afterEach(() => {
  rmSync(destRoot, { recursive: true, force: true })
})

type SpawnCall = { file: string; args: string[] }

function makeDeps(opts: { code?: number; stderr?: string } = {}) {
  const spawnCalls: SpawnCall[] = []
  const spawnFn = vi.fn(async (file: string, args: string[]) => {
    spawnCalls.push({ file, args })
    return { code: opts.code ?? 0, stdout: '', stderr: opts.stderr ?? '' }
  })
  return { deps: { spawnFn }, spawnCalls }
}

describe('cloneRepo', () => {
  it('happy path: shallow-clones the url into dest, returns { path, ok: true }', async () => {
    const url = 'https://x-access-token:secret@github.com/owner/repo.git'
    const dest = join(destRoot, 'repo')
    const { deps, spawnCalls } = makeDeps()

    const result = await cloneRepo(deps, { url, dest })

    expect(result).toEqual({ path: dest, ok: true })
    expect(spawnCalls).toEqual([{ file: 'git', args: ['clone', '--depth', '1', url, dest] }])
  })

  it('refuses a non-github or non-https url before spawning git (the url carries a credential)', async () => {
    for (const bad of [
      'http://github.com/owner/repo.git',
      'https://evil.test/owner/repo.git',
      'git@github.com:owner/repo.git',
      'file:///tmp/x',
      'not a url'
    ]) {
      const { deps, spawnCalls } = makeDeps()
      await expect(cloneRepo(deps, { url: bad, dest: join(destRoot, 'x') })).rejects.toThrow(/refusing non-github clone url/i)
      expect(spawnCalls).toHaveLength(0)
    }
  })

  it('refuses a non-empty existing destination directory before spawning git', async () => {
    mkdirSync(join(destRoot, 'repo'), { recursive: true })
    writeFileSync(join(destRoot, 'repo', 'keep.txt'), 'x')
    const { deps, spawnCalls } = makeDeps()
    await expect(cloneRepo(deps, { url: 'https://github.com/owner/repo.git', dest: join(destRoot, 'repo') })).rejects.toThrow(
      /not empty/i
    )
    expect(spawnCalls).toHaveLength(0)
  })

  it('allows an existing but EMPTY destination directory (git tolerates it)', async () => {
    mkdirSync(join(destRoot, 'repo'), { recursive: true })
    const { deps } = makeDeps()
    const dest = join(destRoot, 'repo')
    const result = await cloneRepo(deps, { url: 'https://github.com/owner/repo.git', dest })
    expect(result.path).toBe(dest)
  })

  it('clone failure throws with a REDACTED stderr (no url, no token)', async () => {
    const url = 'https://x-access-token:secret@github.com/owner/repo.git'
    const { deps } = makeDeps({
      code: 128,
      stderr: `fatal: unable to access '${url}': The requested URL returned error: 403`
    })
    await expect(cloneRepo(deps, { url, dest: join(destRoot, 'repo') })).rejects.toThrow(
      /git clone failed: fatal: unable to access '<clone-url>'/
    )
  })
})
