import { describe, expect, it, vi } from 'vitest'
import { closeTerminalNode } from './terminal-close'

describe('closeTerminalNode', () => {
  it('reports a committed close with pending cleanup when PTY destroy fails', () => {
    const store = {
      stageTerminalNodeClose: vi.fn(),
      removeTerminalNode: vi.fn(),
      completeTerminalNodeClose: vi.fn()
    }
    const result = closeTerminalNode(store, () => {
      throw new Error('tmux busy')
    }, 'project-a', 'terminal-a')

    expect(result).toEqual({ committed: true, cleanupPendingIds: ['terminal-a'] })
    expect(store.stageTerminalNodeClose).toHaveBeenCalledWith('project-a', 'terminal-a')
    expect(store.removeTerminalNode).toHaveBeenCalledWith('project-a', 'terminal-a')
    expect(store.completeTerminalNodeClose).not.toHaveBeenCalled()
  })

  it('reports committed pending cleanup when metadata removal fails after staging', () => {
    const store = {
      stageTerminalNodeClose: vi.fn(),
      removeTerminalNode: vi.fn(() => {
        throw new Error('EIO: project.json')
      }),
      completeTerminalNodeClose: vi.fn()
    }
    const destroyTerminal = vi.fn()

    expect(closeTerminalNode(store, destroyTerminal, 'project-a', 'terminal-a')).toEqual({
      committed: true,
      cleanupPendingIds: ['terminal-a']
    })
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('throws when durable staging fails before the close commits', () => {
    const store = {
      stageTerminalNodeClose: vi.fn(() => {
        throw new Error('EACCES: workspace.json')
      }),
      removeTerminalNode: vi.fn(),
      completeTerminalNodeClose: vi.fn()
    }
    const destroyTerminal = vi.fn()

    expect(() => closeTerminalNode(store, destroyTerminal, 'project-a', 'terminal-a')).toThrow(
      'EACCES: workspace.json'
    )
    expect(destroyTerminal).not.toHaveBeenCalled()
  })
})
