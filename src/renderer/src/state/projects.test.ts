import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedNode } from '@shared/types'
import { useProjects } from './projects'

function node(id: string): SerializedNode {
  return { id, type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal' } }
}

describe('projects node cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    useProjects.setState({
      projects: [{ id: 'project-a', name: 'Project A', cwd: null, closed: false }],
      activeProjectId: 'project-a',
      nodeCache: { 'project-a': [node('terminal-a'), node('terminal-b')] },
      tombstonedNodeIds: {},
      loaded: true
    })
  })

  it('does not let a late save restore a permanently dropped terminal', async () => {
    let resolveSave!: (revision: number) => void
    const saveFinished = new Promise<number>((resolve) => {
      resolveSave = resolve
    })
    vi.stubGlobal('window', {
      termsprawl: {
        workspace: {
          saveNodes: vi.fn(() => saveFinished)
        }
      }
    })

    const staleSnapshot = [node('terminal-a'), node('terminal-b')]
    const saving = useProjects.getState().saveProjectNodes('project-a', staleSnapshot)
    useProjects.getState().dropCachedNode('project-a', 'terminal-a')
    resolveSave(2)
    await saving

    expect(useProjects.getState().nodeCache['project-a'].map((item) => item.id)).toEqual([
      'terminal-b'
    ])
  })

  it('does not load a durably tombstoned terminal while cleanup is pending', async () => {
    vi.stubGlobal('window', {
      termsprawl: {
        workspace: {
          snapshot: vi.fn(async () => ({
            index: {
              version: 1 as const,
              projects: [{ id: 'project-a', name: 'Project A', cwd: null, closed: false }],
              terminalTombstones: [{ projectId: 'project-a', terminalId: 'terminal-a' }]
            },
            projects: { 'project-a': [node('terminal-a'), node('terminal-b')] }
          }))
        }
      }
    })

    await useProjects.getState().load()

    expect(useProjects.getState().nodeCache['project-a'].map((item) => item.id)).toEqual([
      'terminal-b'
    ])
  })
})
