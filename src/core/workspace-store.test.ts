// Workspace persistence round-trip tests (pure fs, no electron).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from './workspace-store'
import { loadProjectFile, type SerializedNode } from './workspace-files'
import type { CorePlatform } from './platform'

class TestPlatform implements CorePlatform {
  userDataPath: string
  constructor() {
    this.userDataPath = mkdtempSync(join(tmpdir(), 'ts-ws-test-'))
  }
  broadcast(): void {}
}

function makeNode(id: string, x: number, y: number): SerializedNode {
  return { id, type: 'terminal', position: { x, y }, data: { kind: 'terminal', title: 'shell' } }
}

describe('WorkspaceStore', () => {
  let platform: TestPlatform
  let store: WorkspaceStore

  beforeEach(() => {
    platform = new TestPlatform()
    store = new WorkspaceStore(platform)
  })

  afterEach(() => {
    rmSync(platform.userDataPath, { recursive: true, force: true })
  })

  it('starts empty', () => {
    expect(store.snapshot().index.projects).toEqual([])
  })

  it('round-trips projects and nodes across a new store instance', () => {
    const project = store.addProject('work', null)
    store.saveNodes(project.id, [makeNode('n1', 10, 20), makeNode('n2', 30, 40)])

    // Fresh store instance = fresh app launch; reads the same files.
    const store2 = new WorkspaceStore(platform)
    const snap = store2.snapshot()
    expect(snap.index.projects).toHaveLength(1)
    expect(snap.index.projects[0].name).toBe('work')
    expect(snap.projects[project.id]).toHaveLength(2)
    expect(snap.projects[project.id][0].position).toEqual({ x: 10, y: 20 })
  })

  it('saves a folder project into .termsprawl/project.json (git-shareable)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ts-ws-cwd-'))
    try {
      const project = store.addProject('folder', cwd)
      store.saveNodes(project.id, [makeNode('n1', 5, 5)])

      const file = loadProjectFile(platform.userDataPath, project)
      expect(file).not.toBeNull()
      expect(file?.nodes).toHaveLength(1)
      // rev is monotonic
      const rev1 = store.saveNodes(project.id, [makeNode('n1', 6, 6)])
      const rev2 = store.saveNodes(project.id, [makeNode('n1', 7, 7)])
      expect(rev2).toBe(rev1 + 1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('close/reopen flags a project without dropping it', () => {
    const project = store.addProject('x', null)
    store.closeProject(project.id)
    expect(store.snapshot().index.projects[0].closed).toBe(true)
    store.reopenProject(project.id)
    expect(store.snapshot().index.projects[0].closed).toBe(false)
  })

  it('delete removes the project from the index', () => {
    const project = store.addProject('gone', null)
    store.deleteProject(project.id)
    expect(store.snapshot().index.projects).toEqual([])
  })
})
