import { describe, expect, it, vi } from 'vitest'
import { LinkService, type LinkServiceDeps } from './service'
import type { NodeLink } from '../../shared/types'

function setup(data: Record<string, unknown>, type = 'chat') {
  const link: NodeLink = { id: 'link', source: 'source', target: 'peer', kind: 'a2a-peer', auto: false, createdAt: 1, config: { kind: 'a2a-peer', message: 'last-output', deliverReply: false } }
  const deps: LinkServiceDeps = {
    allLinks: () => [link], findLink: () => ({ link, projectId: 'project' }),
    projectOfNode: () => ({ id: 'project', cwd: null }),
    capturePane: vi.fn(() => 'bounded pane'), ptyWrite: vi.fn(), chatBroadcast: vi.fn(),
    nodesOfProject: () => [{ id: 'source', type, data }], recordLinkRun: vi.fn(),
    sendToPeer: vi.fn(async () => ({})), userDataPath: '/tmp/unused-link-test'
  }
  return { link, deps, service: new LinkService(deps) }
}

describe('LinkService extraction', () => {
  it('threads the persisted message option through extraction', async () => {
    const { service, deps, link } = setup({ messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: 'answer' }] })
    try {
      await service.runById('link')
      expect(deps.sendToPeer).toHaveBeenLastCalledWith('peer', 'answer', { deliverReply: false, sourceNodeId: 'source' })
      link.config = { kind: 'a2a-peer', message: 'full-capture', deliverReply: false }
      await service.runById('link')
      expect(deps.sendToPeer).toHaveBeenLastCalledWith('peer', 'user: question\n\nassistant: answer', { deliverReply: false, sourceNodeId: 'source' })
    } finally { service.dispose() }
  })

  it('keeps both terminal options on the existing bounded capture', async () => {
    const { service, deps, link } = setup({}, 'terminal')
    try {
      await service.runById('link')
      link.config = { kind: 'a2a-peer', message: 'full-capture', deliverReply: false }
      await service.runById('link')
      expect(deps.capturePane).toHaveBeenCalledTimes(2)
      expect(deps.sendToPeer).toHaveBeenLastCalledWith('peer', 'bounded pane', { deliverReply: false, sourceNodeId: 'source' })
    } finally { service.dispose() }
  })

  it('returns and records explicit remote editor failures', async () => {
    const { service, deps } = setup({ path: '/etc/passwd', remote: { host: 'remote' } }, 'editor')
    try {
      expect(await service.runById('link')).toEqual({ ok: false, summary: 'link failed: remote editor sources are not supported by node links' })
      expect(deps.recordLinkRun).toHaveBeenCalledWith('project', 'link', expect.any(Number), false, expect.stringContaining('remote editor'))
      expect(await service.sendNodeToPeer('source', 'peer')).toMatchObject({ ok: false, summary: expect.stringContaining('remote editor') })
      expect(deps.sendToPeer).not.toHaveBeenCalled()
    } finally { service.dispose() }
  })
})
