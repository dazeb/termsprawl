// Workspace persistence round-trip tests (pure fs, no electron).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from './workspace-store'
import {
  folderProjectPath,
  atomicWriteFile,
  indexPath,
  inlineProjectPath,
  loadIndex,
  loadProjectFile,
  stageProjectFileRemoval,
  type SerializedNode
} from './workspace-files'
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

  it('archive marks a project archived+closed; reopen restores both', () => {
    const project = store.addProject('arch', null)
    store.archiveProject(project.id)
    const meta = store.snapshot().index.projects[0]
    expect(meta.archived).toBe(true)
    expect(meta.closed).toBe(true)

    store.reopenProject(project.id)
    const restored = store.snapshot().index.projects[0]
    expect(restored.archived).toBe(false)
    expect(restored.closed).toBe(false)
  })

  it('archive round-trips across a fresh store instance', () => {
    const project = store.addProject('arch2', null)
    store.archiveProject(project.id)

    const store2 = new WorkspaceStore(platform)
    const meta = store2.snapshot().index.projects[0]
    expect(meta.archived).toBe(true)
  })

  it('delete removes the project from the index', () => {
    const project = store.addProject('gone', null)
    store.deleteProject(project.id)
    expect(store.snapshot().index.projects).toEqual([])
  })

  it('persists pending terminal cleanup until completion', () => {
    const project = store.addProject('pending-cleanup', null)
    store.deleteProject(project.id, ['terminal-a', 'terminal-b'])

    const restarted = new WorkspaceStore(platform)
    expect(restarted.pendingTerminalIdsForProject(project.id)).toEqual(['terminal-a', 'terminal-b'])

    restarted.completeTerminalCleanup(['terminal-a'])
    expect(new WorkspaceStore(platform).pendingTerminalIdsForProject(project.id)).toEqual(['terminal-b'])
  })

  it('tombstones a closed terminal so delayed saves cannot recreate it', () => {
    const project = store.addProject('terminal-close', null)
    const terminal = makeNode('terminal-close-id', 1, 1)
    store.saveNodes(project.id, [terminal, makeNode('keep-node', 2, 2)])

    store.stageTerminalNodeClose(project.id, terminal.id)
    store.removeTerminalNode(project.id, terminal.id)
    store.completeTerminalNodeClose(project.id, terminal.id)
    store.saveNodes(project.id, [terminal, makeNode('keep-node', 3, 3)])

    const restarted = new WorkspaceStore(platform)
    expect(restarted.snapshot().projects[project.id].map((node) => node.id)).toEqual(['keep-node'])
    expect(restarted.pendingTerminalNodeCleanup()).toEqual([])
  })

  it('preserves the live file when an atomic write fails', () => {
    const target = join(platform.userDataPath, 'atomic.json')
    writeFileSync(target, 'original', 'utf8')

    expect(() => atomicWriteFile(target, 'replacement', (temporaryPath) => {
      writeFileSync(temporaryPath, 'partial', 'utf8')
      throw new Error('interrupted write')
    })).toThrow('interrupted write')

    expect(readFileSync(target, 'utf8')).toBe('original')
  })

  it('rolls back an in-memory terminal tombstone when staging cannot persist', () => {
    const project = store.addProject('failed-terminal-close', null)
    const terminal = makeNode('still-live', 1, 1)
    store.saveNodes(project.id, [terminal])
    rmSync(indexPath(platform.userDataPath))
    mkdirSync(indexPath(platform.userDataPath))

    expect(() => store.stageTerminalNodeClose(project.id, terminal.id)).toThrow()
    store.saveNodes(project.id, [terminal])

    expect(loadProjectFile(platform.userDataPath, project)?.nodes.map((node) => node.id)).toEqual([
      terminal.id
    ])
  })

  it('delete removes the inline project file from disk', () => {
    const project = store.addProject('gone2', null)
    store.saveNodes(project.id, [makeNode('n1', 1, 1)])
    store.deleteProject(project.id)
    // A fresh store sees nothing; the orphaned file must not be re-read.
    const store2 = new WorkspaceStore(platform)
    expect(store2.snapshot().index.projects).toEqual([])
    expect(store2.snapshot().projects).toEqual({})
  })

  it('recovers staged metadata when deletion crashes before the index commit', () => {
    const project = store.addProject('recover-staged', null)
    store.saveNodes(project.id, [makeNode('recover-terminal', 1, 1)])
    const staged = stageProjectFileRemoval(platform.userDataPath, project)
    expect(staged).not.toBeNull()

    const recovered = new WorkspaceStore(platform).snapshot()

    expect(recovered.index.projects.map((item) => item.id)).toEqual([project.id])
    expect(recovered.projects[project.id].map((node) => node.id)).toEqual(['recover-terminal'])
    expect(existsSync(inlineProjectPath(platform.userDataPath, project.id))).toBe(true)
  })

  it('delete replaces a read-only index when its directory is writable', () => {
    const project = store.addProject('read-only-index', null)
    chmodSync(indexPath(platform.userDataPath), 0o444)

    expect(() => store.deleteProject(project.id)).not.toThrow()
    expect(new WorkspaceStore(platform).snapshot().index.projects).toEqual([])
  })

  it('rejects inline project ids that could escape the projects directory', () => {
    expect(() => inlineProjectPath(platform.userDataPath, '../../outside')).toThrow(
      'Invalid project id'
    )
  })

  it('drops unsafe project ids loaded from workspace.json', () => {
    writeFileSync(
      indexPath(platform.userDataPath),
      JSON.stringify({
        version: 1,
        projects: [
          { id: '../../outside', name: 'unsafe', cwd: null, closed: false },
          { id: 'safe-project', name: 'safe', cwd: null, closed: false }
        ]
      }),
      'utf8'
    )

    expect(loadIndex(platform.userDataPath).projects.map((project) => project.id)).toEqual([
      'safe-project'
    ])
  })

  it('keeps the project in memory when index persistence fails', () => {
    const project = store.addProject('unwritable-directory', null)
    store.saveNodes(project.id, [makeNode('retry-terminal', 1, 1)])
    chmodSync(platform.userDataPath, 0o555)
    try {
      expect(() => store.deleteProject(project.id)).toThrow(/EACCES/)
      expect(store.snapshot().index.projects.map((item) => item.id)).toEqual([project.id])
    } finally {
      chmodSync(platform.userDataPath, 0o755)
    }

    expect(store.snapshot().projects[project.id].map((node) => node.id)).toEqual(['retry-terminal'])
    store.deleteProject(project.id)
    expect(new WorkspaceStore(platform).snapshot().index.projects).toEqual([])
  })

  it('keeps the project when its metadata file cannot be staged for removal', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ts-ws-locked-cwd-'))
    try {
      const project = store.addProject('locked-metadata', cwd)
      store.saveNodes(project.id, [makeNode('n1', 1, 1)])
      chmodSync(join(cwd, '.termsprawl'), 0o555)

      expect(() => store.deleteProject(project.id)).toThrow(/EACCES/)
      expect(store.snapshot().index.projects.map((item) => item.id)).toEqual([project.id])
      expect(existsSync(folderProjectPath(cwd))).toBe(true)
    } finally {
      chmodSync(join(cwd, '.termsprawl'), 0o755)
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('delete removes Termsprawl metadata but preserves the project folder', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ts-ws-delete-cwd-'))
    try {
      const marker = join(cwd, 'keep-me.txt')
      writeFileSync(marker, 'project content', 'utf8')
      const project = store.addProject('folder-to-remove', cwd)
      store.saveNodes(project.id, [makeNode('n1', 1, 1)])

      store.deleteProject(project.id)

      expect(existsSync(cwd)).toBe(true)
      expect(existsSync(marker)).toBe(true)
      expect(existsSync(folderProjectPath(cwd))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('updateSettings persists an accent per project across relaunch', () => {
    const project = store.addProject('accent', null)
    store.updateSettings(project.id, { accent: '#ff0000' })

    const store2 = new WorkspaceStore(platform)
    const meta = store2.snapshot().index.projects[0]
    expect(meta.settings?.accent).toBe('#ff0000')
  })

  it('updateSettings merges without clobbering existing settings', () => {
    const project = store.addProject('merge', null)
    store.updateSettings(project.id, { accent: '#ff0000' })
    store.updateSettings(project.id, { accent: '#00ff00' })
    expect(store.snapshot().index.projects.find((p) => p.id === project.id)?.settings?.accent).toBe(
      '#00ff00'
    )
  })

  it('rename persists the project name across relaunch', () => {
    const project = store.addProject('old-name', null)
    store.renameProject(project.id, 'new-name')
    const store2 = new WorkspaceStore(platform)
    expect(store2.snapshot().index.projects[0].name).toBe('new-name')
  })
})
