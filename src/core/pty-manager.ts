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
import { resolveCommandLine } from './command-resolver'
import { ensureTmuxConfig, hasSession, sessionNameFor, type TmuxConfig } from './tmux'
import { ScrollbackStore } from './scrollback-store'

const TERMINAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function assertTerminalId(id: string): void {
  if (!TERMINAL_ID_PATTERN.test(id)) throw new Error(`Invalid terminal id: ${id}`)
}

export function isMissingTmuxSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('stderr' in error)) return false
  const stderr = (error as { stderr?: unknown }).stderr
  return typeof stderr === 'string' || Buffer.isBuffer(stderr)
    ? /can't find session:|error connecting to .*\(No such file or directory\)/.test(String(stderr))
    : false
}

export class PtyManager {
  private readonly sessions = new Map<string, pty.IPty>()
  private readonly projectBySession = new Map<string, string>()
  private readonly destroying = new Set<string>()
  private readonly scrollback: ScrollbackStore
  private tmux: TmuxConfig | null

  constructor(private readonly platform: CorePlatform, tmux?: TmuxConfig | null) {
    this.tmux = tmux === undefined ? ensureTmuxConfig(platform.userDataPath) : tmux
    this.scrollback = new ScrollbackStore(platform.userDataPath)
  }

  create(req: PtyCreateRequest): PtyCreateResult {
    assertTerminalId(req.id)
    const shell = req.shell ?? process.env.SHELL ?? '/bin/bash'
    const cwd = req.cwd ?? process.cwd()
    const sessionName = sessionNameFor(req.id)

    // Commands are written as `exec <command>` after PTY listeners attach.
    // Resolve the first token because GUI-launched apps inherit a minimal PATH
    // that may omit user-local agent/editor installs. Without a command this
    // remains a normal interactive shell.
    const command = req.command ? resolveCommandLine(req.command) : undefined
    const sessionCommand = [shell]

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
      spawnArgs = command ? ['-lc', command] : []
    }

    // Strip tmux nesting vars so a reattach inside tmux can't refuse.
    const env: Record<string, string> = { ...process.env, ...req.env } as Record<string, string>
    delete env['TMUX']
    delete env['TMUX_PANE']

    // Remounts reuse stable node ids. Close the previous local PTY client before
    // replacing it; with tmux this only detaches, while fallback shells exit.
    const existing = this.sessions.get(req.id)
    if (existing) existing.kill()

    const session = pty.spawn(spawnFile, spawnArgs, {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd,
      env
    })

    this.sessions.set(req.id, session)
    if (req.projectId) this.projectBySession.set(req.id, req.projectId)
    else this.projectBySession.delete(req.id)
    if (this.tmux) this.scrollback.start(req.id, this.tmux)

    session.onData((data) => {
      if (this.sessions.get(req.id) === session) {
        this.platform.broadcast(ptyDataChannel(req.id), data)
      }
    })
    session.onExit(({ exitCode, signal }) => {
      // A second create with the same stable id supersedes this PTY. Its late
      // exit must not tear down the replacement's ownership or listeners.
      const current = this.sessions.get(req.id)
      if (current && current !== session) return
      const info: PtyExitInfo = { id: req.id, exitCode, signal }
      this.platform.broadcast(ptyExitChannel(req.id), info)
      if (this.destroying.has(req.id)) return
      this.sessions.delete(req.id)
      this.projectBySession.delete(req.id)
      this.scrollback.stop(req.id, this.tmux ?? undefined)
    })

    // Start one-shot presets only after listeners are attached, otherwise a
    // fast command can print and exit before node-pty delivers its first data
    // event. Warm tmux reattachments must not launch the command a second time.
    if (command && fresh && this.tmux) session.write(`exec ${command}\r`)

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
    assertTerminalId(id)
    const session = this.sessions.get(id)
    this.destroying.add(id)
    if (this.tmux) {
      try {
        session?.kill()
      } catch {
        // The tmux session remains authoritative.
      }
      try {
        execFileSync(this.tmux.tmuxPath, [...this.tmux.baseArgs, 'kill-session', '-t', sessionNameFor(id)], {
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 2000
        })
      } catch (error) {
        // "session not found" is success for an idempotent destroy. Preserve
        // ownership on real failures so project deletion can be retried.
        if (!isMissingTmuxSessionError(error)) throw error
      }
    } else if (session) {
      session.kill()
    }
    this.sessions.delete(id)
    this.projectBySession.delete(id)
    this.scrollback.destroy(id)
    this.destroying.delete(id)
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  sessionIdsForProject(projectId: string): string[] {
    return [...this.projectBySession]
      .filter(([, ownerId]) => ownerId === projectId)
      .map(([sessionId]) => sessionId)
  }

  /** Stored scrollback for a cold start (null when none / warm reattach). */
  readScrollback(id: string): string | null {
    assertTerminalId(id)
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
    this.projectBySession.clear()
    this.destroying.clear()
    if (this.tmux) this.scrollback.stopAll(this.tmux)
  }
}
