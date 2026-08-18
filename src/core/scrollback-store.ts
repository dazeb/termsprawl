// Scrollback store — persists a byte-capped snapshot of each tmux session's
// recent output so a COLD start (machine reboot killed the tmux server) can
// replay it. Warm reattaches skip it (tmux redraws anyway).
//
// Snapshot source: `tmux capture-pane -e -p` (history + visible screen, with
// escape codes). Refreshed periodically while a session is attached and once
// more on detach/quit. Deleted with the session on permanent destroy.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { TmuxConfig } from './tmux'
import { sessionNameFor } from './tmux'

const SNAPSHOT_INTERVAL_MS = 5000
const MAX_BYTES = 256 * 1024
const CAPTURE_BACK_LINES = 4000

export class ScrollbackStore {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()
  private readonly dir: string

  constructor(userDataPath: string) {
    this.dir = join(userDataPath, 'terminal-scrollback')
    mkdirSync(this.dir, { recursive: true })
  }

  /** Begin periodic snapshots for a session (called on create).
   *  NO immediate snapshot here: on a cold start the pane is empty, and an
   *  immediate write would overwrite the previous run's stored scrollback —
   *  the very thing the replay needs. Only periodic + final snapshots. */
  start(nodeId: string, tmux: TmuxConfig): void {
    this.stop(nodeId)
    this.timers.set(
      nodeId,
      setInterval(() => this.snapshot(nodeId, tmux), SNAPSHOT_INTERVAL_MS)
    )
  }

  /** Final snapshot + clear the timer (called on detach/quit). */
  stop(nodeId: string, tmux?: TmuxConfig): void {
    const timer = this.timers.get(nodeId)
    if (timer) clearInterval(timer)
    this.timers.delete(nodeId)
    if (tmux) this.snapshot(nodeId, tmux)
  }

  /** Capture the current pane content into the store file (byte-capped). Async: never blocks the caller (tmux can be slow on first server spin-up). */
  snapshot(nodeId: string, tmux: TmuxConfig): void {
    execFile(
      tmux.tmuxPath,
      [...tmux.baseArgs, 'capture-pane', '-e', '-p', '-S', String(-CAPTURE_BACK_LINES), '-t', sessionNameFor(nodeId)],
      { maxBuffer: MAX_BYTES * 2, encoding: 'utf8', timeout: 2000 },
      (err, out) => {
        if (err) return // session gone or tmux busy — keep the last good snapshot
        const capped = out.length > MAX_BYTES ? out.slice(out.length - MAX_BYTES) : out
        try {
          writeFileSync(this.fileFor(nodeId), capped, 'utf8')
        } catch {
          // Shutdown/test cleanup can remove userData while capture-pane is in flight.
        }
      }
    )
  }

  /** The stored snapshot for a session, or null when none. */
  read(nodeId: string): string | null {
    try {
      return readFileSync(this.fileFor(nodeId), 'utf8')
    } catch {
      return null
    }
  }

  /** Drop the store file (permanent destroy of the session). */
  destroy(nodeId: string): void {
    this.stop(nodeId)
    try {
      rmSync(this.fileFor(nodeId), { force: true })
    } catch {
      // already gone
    }
  }

  /** Final snapshot for every live session (app quit). */
  stopAll(tmux: TmuxConfig): void {
    for (const nodeId of [...this.timers.keys()]) {
      this.snapshot(nodeId, tmux)
      this.stop(nodeId)
    }
  }

  private fileFor(nodeId: string): string {
    return join(this.dir, `${nodeId}.txt`)
  }
}
