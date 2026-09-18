import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DependencySetup } from './DependencySetup'
import { setupNoticeNeeded, updateAvailable, useSetup } from '../state/setup'
import type { SetupSnapshot } from '@shared/dependencies'
vi.mock('../state/setup', async (original) => {
  const actual = await original<typeof import('../state/setup')>()
  return { ...actual, useSetup: Object.assign(() => actual.useSetup.getState(), actual.useSetup) }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); useSetup.setState({ snapshot: null, requested: null, error: null }) })
function render(snapshot: SetupSnapshot): string {
  vi.stubGlobal('window', { termsprawl: { dependencies: {} } })
  useSetup.setState({ snapshot })
  return renderToStaticMarkup(<DependencySetup />)
}
describe('dependency setup UI', () => {
  it('offers installation for missing optional agents without requiring one', () => {
    const snapshot: SetupSnapshot = { dependencies: [{ id: 'opencode', name: 'OpenCode', state: 'missing', managed: false }], job: null, systemCommand: null, restartRequired: false }
    const html = render(snapshot)
    expect(html).toContain('Install'); expect(html).toContain('does not sign you in')
    expect(setupNoticeNeeded(snapshot)).toBe(false)
  })
  it('offers updates only for managed agents and open for working external tools', () => {
    const html = render({ dependencies: [{ id: 'opencode', name: 'OpenCode', state: 'installed', managed: false, version: '1.0.0', latest: '2.0.0' }, { id: 'openclaude', name: 'OpenClaude', state: 'installed', managed: true, version: '1.0.0', latest: '2.0.0' }], job: null, systemCommand: null, restartRequired: false })
    expect(html.match(/Update to/g)?.length).toBe(1); expect(html).toContain('External installation'); expect(html).toContain('Open</button>')
  })
  it('shows bounded job progress and failed retries', () => {
    const html = render({ dependencies: [{ id: 'opencode', name: 'OpenCode', state: 'missing', managed: false }], job: { id: '1', agent: 'opencode', state: 'failed', phase: 'Installation failed', error: 'offline', logs: 'download failed' }, systemCommand: null, restartRequired: false })
    expect(html).toContain('Retry'); expect(html).toContain('offline'); expect(html).toContain('Installation log')
  })
  it('warns about missing tmux and offers a visible system terminal', () => {
    const snapshot: SetupSnapshot = { dependencies: [{ id: 'tmux', name: 'tmux', state: 'missing', managed: false }], job: null, systemCommand: 'sudo apt-get install -- tmux', restartRequired: true }
    expect(setupNoticeNeeded(snapshot)).toBe(true)
    const html = render(snapshot); expect(html).toContain('Open installation terminal'); expect(html).toContain('Restart Termsprawl')
    expect(updateAvailable('1.9.0', '1.10.0')).toBe(true)
  })
})
