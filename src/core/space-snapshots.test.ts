// Unit tests for the desktop space-snapshot helpers (Phase 15, D1+D2):
// collision-safe import naming, current-project resolution, and the
// active-project push payload (with the rev map boot restore requires).

import { describe, expect, it } from 'vitest'
import {
  buildProjectPushPayload,
  snapshotCurrentProject,
  uniqueOnlineSnapshotName
} from './space-snapshots'
import type { SerializedNode } from './workspace-files'

function node(id: string): SerializedNode {
  return { id, type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 'shell' } }
}

describe('uniqueOnlineSnapshotName', () => {
  const now = new Date('2026-08-30T12:00:00Z')

  it('suffixes the base name with the locale date', () => {
    const name = uniqueOnlineSnapshotName('terminals', [], now)
    expect(name).toBe(`terminals (online, ${now.toLocaleDateString()})`)
  })

  it('falls back to Canvas when the snapshot project has no name', () => {
    const name = uniqueOnlineSnapshotName('', [], now)
    expect(name).toBe(`Canvas (online, ${now.toLocaleDateString()})`)
  })

  it('appends " 2" when the plain name collides', () => {
    const taken = [uniqueOnlineSnapshotName('work', [], now)]
    expect(uniqueOnlineSnapshotName('work', taken, now)).toBe(
      `${taken[0]} 2`
    )
  })

  it('keeps counting (3, 4, …) past the first free slot', () => {
    const first = uniqueOnlineSnapshotName('work', [], now)
    const taken = [first, `${first} 2`, `${first} 3`]
    expect(uniqueOnlineSnapshotName('work', taken, now)).toBe(`${first} 4`)
  })

  it('never returns an existing name (fuzzed-ish sweep)', () => {
    const first = uniqueOnlineSnapshotName('p', [], now)
    const taken = [first, `${first} 2`, `${first} 3`, `${first} 4`]
    const next = uniqueOnlineSnapshotName('p', taken, now)
    expect(taken).not.toContain(next)
  })

  it('treats whitespace-only names as Canvas', () => {
    expect(uniqueOnlineSnapshotName('   ', [], now)).toBe(
      `Canvas (online, ${now.toLocaleDateString()})`
    )
  })
})

describe('snapshotCurrentProject', () => {
  it('prefers currentProjectId', () => {
    const current = snapshotCurrentProject({
      index: {
        projects: [
          { id: 'p1', name: 'first', cwd: null },
          { id: 'p2', name: 'second', cwd: null }
        ]
      },
      projects: { p1: [node('n1')], p2: [node('n2')] },
      currentProjectId: 'p2'
    })
    expect(current?.id).toBe('p2')
    expect(current?.name).toBe('second')
    expect(current?.nodes).toEqual([node('n2')])
  })

  it('falls back to the first open project, then the first project', () => {
    const open = snapshotCurrentProject({
      index: {
        projects: [
          { id: 'p1', name: 'closed', cwd: null, closed: true },
          { id: 'p2', name: 'open', cwd: null }
        ]
      },
      projects: { p1: [node('n1')], p2: [node('n2')] }
    })
    expect(open?.id).toBe('p2')

    const any = snapshotCurrentProject({
      index: { projects: [{ id: 'p1', name: 'closed', cwd: null, closed: true }] },
      projects: { p1: [node('n1')] }
    })
    expect(any?.id).toBe('p1')
  })

  it('tolerates a missing nodes blob and a malformed workspace', () => {
    const missing = snapshotCurrentProject({
      index: { projects: [{ id: 'p1', name: 'x', cwd: null }] },
      projects: {}
    })
    expect(missing?.nodes).toEqual([])

    expect(snapshotCurrentProject(undefined)).toBeNull()
    expect(snapshotCurrentProject({} as never)).toBeNull()
    expect(snapshotCurrentProject({ index: {}, projects: {} } as never)).toBeNull()
  })
})

describe('buildProjectPushPayload', () => {
  it('wraps exactly the active project with its rev and currentProjectId', () => {
    const payload = buildProjectPushPayload(
      { id: 'p9', name: 'active', cwd: null, nodes: [node('n1')], rev: 7 },
      { 'n1': 'boot log' }
    )
    expect(payload.workspace).toEqual({
      index: { version: 1, projects: [{ id: 'p9', name: 'active', cwd: null }] },
      projects: { p9: [node('n1')] },
      currentProjectId: 'p9',
      revs: { p9: 7 }
    })
    expect(payload.files).toEqual({})
    expect(payload.scrollbacks).toEqual({ n1: 'boot log' })
  })

  it('carries the folder-project file keyed by the cwd path', () => {
    const projectFile = { version: 1, rev: 7, nodes: [node('n1')] }
    const payload = buildProjectPushPayload(
      { id: 'p9', name: 'foldered', cwd: '/home/me/repo', nodes: [node('n1')], rev: 7, projectFile },
      {}
    )
    expect(payload.files).toEqual({
      '/home/me/repo/.termsprawl/project.json': projectFile
    })
  })

  it('omits files for a cwd-less (inline) project', () => {
    const payload = buildProjectPushPayload(
      { id: 'p9', name: 'inline', cwd: null, nodes: [], rev: 0, projectFile: { accident: true } },
      {}
    )
    expect(payload.files).toEqual({})
  })
})
