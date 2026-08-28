// Server Edition smoke test — RPC routing + platform broadcast. No listener is
// booted here; the live server is verified by running it (and by the ws test
// against real hermes-box/service hosts elsewhere).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerPlatform } from './platform'
import { buildHandlers } from './handlers'
import { createDispatcher } from './rpc'
import { IPC } from '../shared/ipc'

describe('ServerPlatform', () => {
  it('broadcasts a channel+payload to the sendAll fan-out', () => {
    const sendAll = vi.fn()
    const platform = new ServerPlatform(sendAll, '/tmp/x')
    platform.broadcast('pty:data:abc', 'hello')
    expect(sendAll).toHaveBeenCalledWith('pty:data:abc', 'hello')
  })

  it('uses an override userDataPath', () => {
    const platform = new ServerPlatform(() => {}, '/custom/data')
    expect(platform.userDataPath).toBe('/custom/data')
  })
})

describe('server handlers', () => {
  let dir: string
  let platform: ServerPlatform
  let dispatch: ReturnType<typeof createDispatcher>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ts-server-'))
    platform = new ServerPlatform(() => {}, dir)
    dispatch = createDispatcher(buildHandlers(platform))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('app:version returns a dotted version string', async () => {
    const res = await dispatch({ id: 1, method: IPC.appVersion, args: [] })
    expect(res?.ok).toBe(true)
    expect(typeof res?.result).toBe('string')
    expect(res?.result).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('app:settings-get returns a normalized AppSettings', async () => {
    const res = await dispatch({ id: 2, method: IPC.appSettingsGet, args: [] })
    expect(res?.ok).toBe(true)
    expect(res?.result).toMatchObject({ autoDownloadUpdates: expect.any(Boolean), accounts: [] })
  })

  it('workspace:snapshot returns an empty index and no projects', async () => {
    const res = await dispatch({ id: 3, method: IPC.workspaceSnapshot, args: [] })
    expect(res?.ok).toBe(true)
    const snap = res?.result as { index: { projects: unknown[] }; projects: Record<string, unknown> }
    expect(snap.index.projects).toEqual([])
    expect(snap.projects).toEqual({})
  })

  it('project:add creates a project and snapshot round-trips it', async () => {
    const add = await dispatch({ id: 4, method: IPC.projectAdd, args: ['demo', null] })
    expect(add?.ok).toBe(true)
    const snap = await dispatch({ id: 5, method: IPC.workspaceSnapshot, args: [] })
    const projects = (snap?.result as { index: { projects: Array<{ name: string }> } }).index.projects
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('demo')
  })

  it('an unhandled channel rejects with a clear error', async () => {
    const res = await dispatch({ id: 6, method: 'does:not-exist', args: ['/x'] })
    expect(res?.ok).toBe(false)
    expect(res?.error).toContain('unhandled')
  })

  it('git:snapshot returns a snapshot for a known repo', async () => {
    const res = await dispatch({ id: 7, method: IPC.gitSnapshot, args: [{ cwd: process.cwd() }] })
    expect(res?.ok).toBe(true)
    const snap = res?.result as Record<string, unknown>
    expect(typeof snap?.branch).toBe('string')
    expect(Array.isArray(snap?.changes)).toBe(true)
  })

  it('diff:info returns a result for a known file', async () => {
    const res = await dispatch({ id: 8, method: IPC.diffInfo, args: ['package.json', 'HEAD'] })
    expect(res?.ok).toBe(true)
    const info = res?.result as Record<string, unknown>
    expect(typeof info?.original).toBe('string')
    expect(typeof info?.modified).toBe('string')
  })
})
