// Phase 9 — remote project purity: how a project's remote destination is
// derived and displayed. Electron-free; the renderer labels remote projects
// and the add-remote dialog validates/normalizes the destination.

import { describe, expect, it } from 'vitest'
import { isRemoteProject, remoteLabel, normalizeRemote } from './remote-project'
import type { ProjectRemote } from '../shared/types'

describe('remote-project', () => {
  it('isRemoteProject is true only when a remote destination is set', () => {
    expect(isRemoteProject({ remote: { host: 'box', path: '/srv/x' } })).toBe(true)
    expect(isRemoteProject({ cwd: '/home/dev/x' })).toBe(false)
    expect(isRemoteProject({})).toBe(false)
  })

  it('remoteLabel renders host:path for a bare host', () => {
    const remote: ProjectRemote = { host: 'box', path: '/srv/x' }
    expect(remoteLabel(remote)).toBe('box:/srv/x')
  })

  it('remoteLabel prefixes user@ and :port when present', () => {
    expect(remoteLabel({ user: 'root', host: 'box', path: '/srv/x' })).toBe('root@box:/srv/x')
    expect(remoteLabel({ user: 'root', host: 'box', port: 22, path: '/srv/x' })).toBe(
      'root@box:22:/srv/x'
    )
  })

  it('normalizeRemote trims whitespace and drops empty user/port', () => {
    expect(normalizeRemote({ host: '  box  ', path: ' /srv/x ' })).toEqual({
      host: 'box',
      path: '/srv/x'
    })
    expect(normalizeRemote({ host: 'box', path: '/srv/x', user: ' ', port: undefined })).toEqual({
      host: 'box',
      path: '/srv/x'
    })
  })

  it('normalizeRemote rejects a missing host or path', () => {
    expect(normalizeRemote({ host: '', path: '/srv/x' })).toBeNull()
    expect(normalizeRemote({ host: 'box', path: '' })).toBeNull()
  })
})
