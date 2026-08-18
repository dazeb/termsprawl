import { describe, expect, it, vi } from 'vitest'
import { deleteProjectAndDestroyTerminals } from './project-deletion'
import type { WorkspaceSnapshot } from './workspace-store'

function snapshotWithTerminals(): WorkspaceSnapshot {
  return {
    index: {
      version: 1,
      projects: [{ id: 'p1', name: 'project', cwd: '/work/project', closed: false }]
    },
    projects: {
      p1: [
        { id: 't1', type: 'terminal', position: { x: 0, y: 0 }, data: {} },
        { id: 'note1', type: 'sticky', position: { x: 1, y: 1 }, data: {} }
      ]
    }
  }
}

describe('deleteProjectAndDestroyTerminals', () => {
  it('does not destroy terminals when project deletion fails to persist', () => {
    const store = {
      snapshot: vi.fn(snapshotWithTerminals),
      pendingTerminalIdsForProject: vi.fn(() => []),
      completeTerminalCleanup: vi.fn(),
      deleteProject: vi.fn(() => {
        throw new Error('EACCES: workspace.json')
      })
    }
    const destroyTerminal = vi.fn()

    expect(() => deleteProjectAndDestroyTerminals(store, destroyTerminal, 'p1')).toThrow(
      'EACCES: workspace.json'
    )
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('continues cleaning up terminal sessions when one destroy fails', () => {
    const snap = snapshotWithTerminals()
    snap.projects.p1.push({ id: 't2', type: 'terminal', position: { x: 2, y: 2 }, data: {} })
    const store = {
      snapshot: vi.fn(() => snap),
      pendingTerminalIdsForProject: vi.fn(() => []),
      completeTerminalCleanup: vi.fn(),
      deleteProject: vi.fn()
    }
    const destroyTerminal = vi.fn((id: string) => {
      if (id === 't1') throw new Error('session already disconnected')
    })

    const result = deleteProjectAndDestroyTerminals(store, destroyTerminal, 'p1')
    expect(result).toEqual({ committed: true, cleanupPendingIds: ['t1'] })
    expect(store.deleteProject).toHaveBeenCalledWith('p1', ['t1', 't2'])
    expect(store.completeTerminalCleanup).toHaveBeenCalledWith(['t2'])
    expect(destroyTerminal).toHaveBeenCalledTimes(2)
    expect(destroyTerminal).toHaveBeenLastCalledWith('t2')
  })

  it('destroys a live terminal that has not reached persisted node state yet', () => {
    const store = {
      snapshot: vi.fn(snapshotWithTerminals),
      pendingTerminalIdsForProject: vi.fn(() => ['from-previous-run']),
      completeTerminalCleanup: vi.fn(),
      deleteProject: vi.fn()
    }
    const destroyTerminal = vi.fn()

    deleteProjectAndDestroyTerminals(store, destroyTerminal, 'p1', ['just-created'])

    expect(destroyTerminal).toHaveBeenCalledWith('t1')
    expect(destroyTerminal).toHaveBeenCalledWith('just-created')
    expect(destroyTerminal).toHaveBeenCalledWith('from-previous-run')
    expect(store.deleteProject).toHaveBeenCalledWith('p1', ['t1', 'just-created', 'from-previous-run'])
    expect(store.completeTerminalCleanup).toHaveBeenCalledWith(['t1', 'just-created', 'from-previous-run'])
    expect(destroyTerminal).toHaveBeenCalledTimes(3)
  })

  it('reports cleanup as pending when clearing the durable retry record fails', () => {
    const store = {
      snapshot: vi.fn(snapshotWithTerminals),
      pendingTerminalIdsForProject: vi.fn(() => ['t1']),
      completeTerminalCleanup: vi.fn(() => {
        throw new Error('EIO: workspace.json')
      }),
      deleteProject: vi.fn()
    }

    const result = deleteProjectAndDestroyTerminals(store, vi.fn(), 'p1')

    expect(result).toEqual({ committed: true, cleanupPendingIds: ['t1'] })
  })
})
