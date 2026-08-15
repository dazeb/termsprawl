// Integration tests: the PtyManager spawns a real shell through node-pty and
// streams output through the CorePlatform seam. With tmux available, sessions
// survive manager destruction and reattach warm.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PtyManager } from './pty-manager'
import type { CorePlatform } from './platform'

interface Captured {
  data: string
  exit?: { id: string; exitCode: number }
}

class StubPlatform implements CorePlatform {
  captured: Captured[] = []
  userDataPath: string
  constructor() {
    this.userDataPath = mkdtempSync(join(tmpdir(), 'termsprawl-test-'))
  }
  broadcast(channel: string, payload: unknown): void {
    if (channel.startsWith('pty:data') || channel.startsWith('pty:exit')) {
      this.captured.push({
        data: String(payload),
        ...(channel.startsWith('pty:exit') ? { exit: payload as never } : {})
      })
    }
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 12000): Promise<void> {
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
  const platforms: StubPlatform[] = []

  function makeManager(sharedUserDataPath?: string): { manager: PtyManager; platform: StubPlatform } {
    const platform = new StubPlatform()
    if (sharedUserDataPath) platform.userDataPath = sharedUserDataPath
    const manager = new PtyManager(platform)
    managers.push(manager)
    platforms.push(platform)
    return { manager, platform }
  }

  afterEach(() => {
    for (const m of managers) m.killAll()
    for (const p of platforms) rmSync(p.userDataPath, { recursive: true, force: true })
  })

  it('spawns a shell and echoes output through the platform', async () => {
    const { manager, platform } = makeManager()

    const result = manager.create({ id: 't1', cols: 80, rows: 24, cwd: process.cwd() })
    expect(result.pid).toBeGreaterThan(0)

    manager.write('t1', 'echo TERMSPRAWL_OK\r')

    await waitFor(() => platform.captured.some((c) => c.data.includes('TERMSPRAWL_OK')))
    expect(platform.captured.some((c) => c.data.includes('TERMSPRAWL_OK'))).toBe(true)
  })

  it('runs a command instead of a bare shell when one is given', async () => {
    const { manager, platform } = makeManager()

    const result = manager.create({
      id: 'cmd1',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      command: 'echo COMMAND_MARK'
    })
    expect(result.pid).toBeGreaterThan(0)

    await waitFor(() => platform.captured.some((c) => c.data.includes('COMMAND_MARK')))
    expect(platform.captured.some((c) => c.data.includes('COMMAND_MARK'))).toBe(true)
  })

  it('emits an exit event when the session is destroyed', async () => {
    const { manager, platform } = makeManager()

    manager.create({ id: 't2', cols: 80, rows: 24, cwd: process.cwd() })
    manager.destroy('t2')

    await waitFor(() => platform.captured.some((c) => c.exit))
    const exit = platform.captured.find((c) => c.exit)
    expect(exit?.exit?.id).toBe('t2')
  })

  it('ignores writes and resizes for unknown sessions', () => {
    const { manager } = makeManager()

    expect(() => {
      manager.write('nope', 'x')
      manager.resize('nope', 10, 10)
      manager.destroy('nope')
    }).not.toThrow()
  })

  it('tmux: session survives killAll and reattaches warm', async () => {
    const { manager, platform } = makeManager()

    const first = manager.create({ id: 'persist', cols: 80, rows: 24, cwd: process.cwd() })
    manager.write('persist', 'echo FIRST_MARK\r')
    await waitFor(() => platform.captured.some((c) => c.data.includes('FIRST_MARK')))

    // Simulate app quit: clients detach, tmux sessions keep running.
    manager.killAll()

    // Fresh manager (new app launch) reattaches the same session — warm.
    // Same userDataPath = same tmux socket = same tmux server.
    const { manager: manager2, platform: platform2 } = makeManager(platform.userDataPath)
    const second = manager2.create({ id: 'persist', cols: 80, rows: 24, cwd: process.cwd() })
    expect(second.fresh).toBe(false)

    manager2.write('persist', 'echo SECOND_MARK\r')
    await waitFor(() => platform2.captured.some((c) => c.data.includes('SECOND_MARK')))
    expect(platform2.captured.some((c) => c.data.includes('SECOND_MARK'))).toBe(true)
  })

  it('tmux: fresh=true when the session does not exist yet', async () => {
    const { manager } = makeManager()
    const result = manager.create({ id: 'brand-new', cols: 80, rows: 24, cwd: process.cwd() })
    expect(result.fresh).toBe(true)
  })

  it('tmux: destroy kills the session permanently (next create is fresh)', async () => {
    const { manager } = makeManager()
    manager.create({ id: 'doomed', cols: 80, rows: 24, cwd: process.cwd() })
    manager.destroy('doomed')

    // The session is gone; recreating is a cold start.
    const again = manager.create({ id: 'doomed', cols: 80, rows: 24, cwd: process.cwd() })
    expect(again.fresh).toBe(true)
  })

  it('tmux: scrollback snapshot is readable on a cold start', { timeout: 15000 }, async () => {
    const { manager, platform } = makeManager()

    manager.create({ id: 'scroll', cols: 80, rows: 24, cwd: process.cwd() })
    manager.write('scroll', 'echo SCROLLBACK_MARK\r')
    await waitFor(() => platform.captured.some((c) => c.data.includes('SCROLLBACK_MARK')))

    // Detach (as on quit) triggers a final snapshot; wait for it to contain
    // the mark (an early blank file is not a useful snapshot).
    manager.killAll()
    await waitFor(() => manager.readScrollback('scroll')?.includes('SCROLLBACK_MARK') ?? false)
    const snap = manager.readScrollback('scroll')
    expect(snap).toContain('SCROLLBACK_MARK')
  })
})
