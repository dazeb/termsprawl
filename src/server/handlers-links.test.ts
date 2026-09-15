import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { CorePlatform } from '../core/platform'

const mocks = vi.hoisted(() => ({ ptyPlatform: undefined as CorePlatform | undefined, activity: vi.fn(), dispose: vi.fn() }))
vi.mock('../core/pty-manager', () => ({ PtyManager: class {
  constructor(platform: CorePlatform) { mocks.ptyPlatform = platform }
} }))
vi.mock('../core/links/service', () => ({ LinkService: class {
  notePtyActivity = mocks.activity
  dispose = mocks.dispose
} }))
import { buildHandlers } from './handlers'
import { IPC, ptyDataChannel, ptyExitChannel } from '../shared/ipc'

let dir: string
 afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks() })

it('taps PTY output once without changing data or exit broadcasts and exposes disposal', () => {
  dir = mkdtempSync(join(tmpdir(), 'ts-link-handlers-'))
  const broadcast = vi.fn()
  let dispose: (() => void) | undefined
  const handlers = buildHandlers({ userDataPath: dir, broadcast }, { onDispose: (fn) => { dispose = fn } })
  const bytes = '\x1b[32moutput\r\n'
  mocks.ptyPlatform!.broadcast(ptyDataChannel('terminal'), bytes)
  mocks.ptyPlatform!.broadcast(ptyExitChannel('terminal'), { exitCode: 0 })
  expect(broadcast.mock.calls).toEqual([[`${IPC.ptyData}:terminal`, bytes], [ptyExitChannel('terminal'), { exitCode: 0 }]])
  expect(mocks.activity).toHaveBeenCalledExactlyOnceWith('terminal')
  expect(handlers.dispose).toBeUndefined()
  dispose!()
  expect(mocks.dispose).toHaveBeenCalledOnce()
})
