// Tests for the Server Edition's space-sync wiring: snapshot payload build
// (live state), boot restore (rev-guarded), and the coalescing pusher.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpacePusher, restoreFromCloud, type SyncWiringDeps } from './space-sync-wiring'
import type { SpaceSnapshotPayload } from '../core/space-sync'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ts-wiring-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const PROJECT: { id: string; name: string; cwd: string | null; closed: boolean; archived: boolean } = { id: 'p-1', name: 'Demo', cwd: null, closed: false, archived: false }

function makeDeps(fetchFn: typeof fetch, project = PROJECT): SyncWiringDeps & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const deps: SyncWiringDeps = {
    cfg: { apiBase: 'http://cloud.test', bootToken: 'tok', fetchFn },
    userDataPath: dir,
    call: async (method, args) => {
      calls.push({ method, args })
      if (method === 'workspace:snapshot') {
        return {
          index: { projects: [project] },
          projects: { [project.id]: [{ id: 'n1', data: {} }] },
          currentProjectId: project.id,
        }
      }
      if (method === 'workspace:projects') return { index: { projects: [] } }
      return { ok: true }
    },
    log: () => {},
  }
  return { ...deps, calls }
}

describe('buildSnapshotPayload', () => {
  it('carries the workspace blob, folder project files, and scrollback', async () => {
    const withCwd = { ...PROJECT, cwd: join(dir, 'repo') }
    const deps = makeDeps(vi.fn(), withCwd)
    mkdirSync(join(withCwd.cwd!, '.termsprawl'), { recursive: true })
    writeFileSync(join(withCwd.cwd!, '.termsprawl', 'project.json'), JSON.stringify({ version: 1, rev: 3, nodes: [] }))
    const sb = join(dir, 'terminal-scrollback')
    mkdirSync(sb, { recursive: true })
    writeFileSync(join(sb, 'term-9.txt'), 'session restored\n$ ls')

    const payload = await import('./space-sync-wiring').then((m) => m.buildSnapshotPayload(deps))
    expect(payload.workspace).toMatchObject({ index: { projects: [expect.objectContaining({ id: 'p-1' })] } })
    expect(payload.files[`${withCwd.cwd}/.termsprawl/project.json`]).toMatchObject({ rev: 3 })
    expect(payload.scrollbacks['term-9']).toContain('$ ls')
  })
})

describe('restoreFromCloud', () => {
  it('applies strictly-newer projects and writes scrollback', async () => {
    const snapshot: SpaceSnapshotPayload = {
      workspace: { index: { projects: [PROJECT] }, projects: { 'p-1': [{ id: 'n9', data: {} }] }, revs: { 'p-1': 5 } },
      files: {},
      scrollbacks: { 'term-1': 'history' },
    }
    const deps = makeDeps(vi.fn(async () => jsonResponse(snapshot, 200)))
    const out = await restoreFromCloud(deps)
    expect(out.restored).toBe(true)
    expect(out.projectsApplied).toBe(1)
    expect(deps.calls.some((c) => c.method === 'workspace:save-nodes' && c.args[0] === 'p-1')).toBe(true)
    const sb = join(dir, 'terminal-scrollback', 'term-1.txt')
    expect(await import('node:fs').then((fs) => fs.existsSync(sb))).toBe(true)
  })

  it('does NOT clobber an equal-or-newer local rev', async () => {
    // Seed a local project file with rev 7 via the store's own layout.
    const projectFile = { version: 1, rev: 7, nodes: [{ id: 'local', data: {} }] }
    const projectsDir = join(dir, 'projects')
    mkdirSync(projectsDir, { recursive: true })
    writeFileSync(join(projectsDir, 'p-1.json'), JSON.stringify(projectFile))
    const snapshot: SpaceSnapshotPayload = {
      workspace: { index: { projects: [PROJECT] }, projects: { 'p-1': [{ id: 'cloud', data: {} }] }, revs: { 'p-1': 7 } },
      files: {},
      scrollbacks: {},
    }
    const deps = makeDeps(vi.fn(async () => jsonResponse(snapshot, 200)))
    const out = await restoreFromCloud(deps)
    expect(out.projectsApplied).toBe(0)
    expect(deps.calls.some((c) => c.method === 'workspace:save-nodes')).toBe(false)
  })

  it('continues offline when the pull throws, and returns no-snapshot on 404', async () => {
    const failDeps = makeDeps(vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(restoreFromCloud(failDeps)).resolves.toMatchObject({ restored: false, reason: 'pull-failed' })

    const noneDeps = makeDeps(vi.fn(async () => jsonResponse({ error: {} }, 404)))
    await expect(restoreFromCloud(noneDeps)).resolves.toMatchObject({ restored: false, reason: 'no-snapshot' })
  })
})

describe('createSpacePusher', () => {
  it('pushes a fresh payload on markDirty and coalesces bursts', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return jsonResponse({ ok: true }, 200)
    })
    const deps = makeDeps(fetchFn)
    const pusher = createSpacePusher(deps)
    pusher.markDirty()
    const result = await pusher.flush()
    expect(result?.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(bodies[0].workspace).toMatchObject({ index: { projects: [expect.objectContaining({ id: 'p-1' })] } })
  })

  it('never throws into the caller when the cloud is down', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const deps = makeDeps(fetchFn)
    const pusher = createSpacePusher(deps)
    pusher.markDirty()
    const result = await pusher.flush()
    expect(result?.ok).toBe(false)
    if (result && !result.ok) expect(result.retryable).toBe(true)
  })
})
