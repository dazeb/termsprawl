// PTY manager — spawns and owns terminal sessions.
//
// Phase 2: plain node-pty sessions keyed by a stable per-node id.
// Phase 4: each session moves inside a persistent tmux session so terminals
// survive app restarts (the id becomes the tmux session key).
//
// Electron-free: talks to the outside world only through CorePlatform.

import * as pty from 'node-pty'
import type { CorePlatform } from './platform'
import { ptyDataChannel, ptyExitChannel } from '../shared/ipc'
import type { PtyCreateRequest, PtyCreateResult, PtyExitInfo } from '../shared/types'

export class PtyManager {
  private readonly sessions = new Map<string, pty.IPty>()

  constructor(private readonly platform: CorePlatform) {}

  create(req: PtyCreateRequest): PtyCreateResult {
    const shell = req.shell ?? process.env.SHELL ?? '/bin/bash'
    const session = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd: req.cwd ?? process.cwd(),
      env: { ...process.env, ...req.env } as Record<string, string>
    })

    this.sessions.set(req.id, session)

    session.onData((data) => {
      this.platform.broadcast(ptyDataChannel(req.id), data)
    })
    session.onExit(({ exitCode, signal }) => {
      const info: PtyExitInfo = { id: req.id, exitCode, signal }
      this.platform.broadcast(ptyExitChannel(req.id), info)
      this.sessions.delete(req.id)
    })

    return { id: req.id, pid: session.pid, fresh: true }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows)
  }

  destroy(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.kill()
    this.sessions.delete(id)
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /** Detach everything — deliberately does NOT kill tmux sessions (Phase 4). */
  killAll(): void {
    for (const session of this.sessions.values()) {
      session.kill()
    }
    this.sessions.clear()
  }
}
