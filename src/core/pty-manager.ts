// PTY manager — spawns and owns terminal sessions.
//
// Each session runs inside a persistent tmux session (dedicated socket +
// generated config), so terminals survive app restarts: node unmount detaches,
// app quit detaches, and reopening reattaches to the same tmux session. The
// node id is the tmux session key — keep it stable.
//
// create() probes `tmux has-session` BEFORE spawning so the result carries a
// `fresh` flag: false = warm reattach (tmux redraws), true = cold start.
//
// If tmux is unavailable, falls back to a plain shell (no cross-restart
// continuity) and reports fresh: true.
//
// Electron-free: talks to the outside world only through CorePlatform.

import { execFileSync } from 'node:child_process'
import * as pty from 'node-pty'
import type { CorePlatform } from './platform'
import { ptyDataChannel, ptyExitChannel } from '../shared/ipc'
import type { PtyCreateRequest, PtyCreateResult, PtyExitInfo } from '../shared/types'
import { ensureTmuxConfig, hasSession, sessionNameFor, type TmuxConfig } from './tmux'
import { ScrollbackStore } from './scrollback-store'

export class PtyManager {
  private readonly sessions = new Map<string, pty.IPty>()
  private readonly scrollback: ScrollbackStore
  private tmux: TmuxConfig | null

  constructor(private readonly platform: CorePlatform) {
    this.tmux = ensureTmuxConfig(platform.userDataPath)
    this.scrollback = new ScrollbackStore(platform.userDataPath)
  }

  create(req: PtyCreateRequest): PtyCreateResult {
    const shell = req.shell ?? process.env.SHELL ?? '/bin/bash'
    const cwd = req.cwd ?? process.cwd()
    const sessionName = sessionNameFor(req.id)

    // With a command, run `shell -lc <command>` inside the session (login
    // shell so the user's PATH from .zshrc/.profile applies — druk lives in
    // ~/.druk/bin, sourced in .zshrc). Without one, a bare interactive shell.
    const sessionCommand = req.command ? [shell, '-lc', req.command] : [shell]

    let fresh = true
    let spawnFile = shell
    let spawnArgs: string[] = []

    if (this.tmux) {
      fresh = !hasSession(this.tmux, req.id)
      spawnFile = this.tmux.tmuxPath
      spawnArgs = [
        ...this.tmux.baseArgs,
        'new-session',
        '-A',
        '-D',
        '-s',
        sessionName,
        '--',
        ...sessionCommand
      ]
    } else {
      spawnArgs = req.command ? ['-lc', req.command] : []
    }

    // Strip tmux nesting vars so a reattach inside tmux can't refuse.
    const env: Record<string, string> = { ...process.env, ...req.env } as Record<string, string>
    delete env['TMUX']
    delete env['TMUX_PANE']

    const session = pty.spawn(spawnFile, spawnArgs, {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd,
      env
    })

    this.sessions.set(req.id, session)
    if (this.tmux) this.scrollback.start(req.id, this.tmux)

    session.onData((data) => {
      this.platform.broadcast(ptyDataChannel(req.id), data)
    })
    session.onExit(({ exitCode, signal }) => {
      const info: PtyExitInfo = { id: req.id, exitCode, signal }
      this.platform.broadcast(ptyExitChannel(req.id), info)
      this.sessions.delete(req.id)
      this.scrollback.stop(req.id, this.tmux ?? undefined)
    })

    return { id: req.id, pid: session.pid, fresh }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows)
  }

  /** Permanent: kills the tmux session too, so nothing survives. */
  destroy(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.kill()
      this.sessions.delete(id)
    }
    this.scrollback.destroy(id)
    if (this.tmux) {
      try {
        execFileSync(this.tmux.tmuxPath, [...this.tmux.baseArgs, 'kill-session', '-t', sessionNameFor(id)], {
          stdio: 'ignore',
          timeout: 2000
        })
      } catch {
        // session already gone — fine
      }
    }
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /** Stored scrollback for a cold start (null when none / warm reattach). */
  readScrollback(id: string): string | null {
    return this.scrollback.read(id)
  }

  /**
   * Detach everything on quit — deliberately does NOT kill tmux sessions,
   * so terminals keep running and reattach on next launch.
   */
  killAll(): void {
    for (const session of this.sessions.values()) {
      session.kill()
    }
    this.sessions.clear()
    if (this.tmux) this.scrollback.stopAll(this.tmux)
  }
}
