// Integration test: the PtyManager spawns a real shell through node-pty and
// streams output through the CorePlatform seam. This is the vertical slice —
// if this passes, the main-process wiring (which is a thin IPC layer over the
// same manager) works.

import { afterEach, describe, expect, it } from 'vitest'
import { PtyManager } from './pty-manager'
import type { CorePlatform } from './platform'
import { ptyDataChannel, ptyExitChannel } from '../shared/ipc'

interface Captured {
  data: string
  exit?: { id: string; exitCode: number }
}

class StubPlatform implements CorePlatform {
  captured: Captured[] = []
  broadcast(channel: string, payload: unknown): void {
    if (channel.startsWith('pty:data') || channel.startsWith('pty:exit')) {
      this.captured.push({ data: String(payload), ...(channel.startsWith('pty:exit') ? { exit: payload as never } : {}) })
    }
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

describe('PtyManager', () => {
  const managers: PtyManager[] = []

  afterEach(() => {
    for (const m of managers) m.killAll()
  })

  it('spawns a shell and echoes output through the platform', async () => {
    const platform = new StubPlatform()
    const manager = new PtyManager(platform)
    managers.push(manager)

    const result = manager.create({ id: 't1', cols: 80, rows: 24, cwd: process.cwd() })
    expect(result.pid).toBeGreaterThan(0)

    manager.write('t1', 'echo TERMSPRAWL_OK\r')

    await waitFor(() => platform.captured.some((c) => c.data.includes('TERMSPRAWL_OK')))
    expect(platform.captured.some((c) => c.data.includes('TERMSPRAWL_OK'))).toBe(true)
  })

  it('emits an exit event when the session is destroyed', async () => {
    const platform = new StubPlatform()
    const manager = new PtyManager(platform)
    managers.push(manager)

    manager.create({ id: 't2', cols: 80, rows: 24, cwd: process.cwd() })
    manager.destroy('t2')

    await waitFor(() => platform.captured.some((c) => c.exit))
    const exit = platform.captured.find((c) => c.exit)
    expect(exit?.exit?.id).toBe('t2')
  })

  it('ignores writes and resizes for unknown sessions', () => {
    const platform = new StubPlatform()
    const manager = new PtyManager(platform)
    managers.push(manager)

    expect(() => {
      manager.write('nope', 'x')
      manager.resize('nope', 10, 10)
      manager.destroy('nope')
    }).not.toThrow()
  })
})

// Keep the channel helper honest: data/exit channels derive from the ids.
describe('pty channels', () => {
  it('derives per-session channel names', () => {
    expect(ptyDataChannel('abc')).toBe('pty:data:abc')
    expect(ptyExitChannel('abc')).toBe('pty:exit:abc')
  })
})
