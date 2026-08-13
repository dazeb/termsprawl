// tmux integration — pure helpers, no electron.
//
// Every terminal runs inside a persistent tmux session on a dedicated socket
// with a generated config, so sessions outlive the app. The node id is the
// session key; keep it stable.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TMUX_SOCKET = 'termsprawl'
export const SESSION_PREFIX = 'ts-'

/** Resolve an absolute tmux path (GUI apps don't inherit shell PATH). */
export function findTmux(): string | null {
  const candidates = ['/usr/bin/tmux', '/usr/local/bin/tmux', '/opt/homebrew/bin/tmux']
  if (process.env.PATH) {
    for (const dir of process.env.PATH.split(':')) {
      const p = join(dir, 'tmux')
      if (existsSync(p)) return p
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null
}

/** A tmux session name derived from a stable node id. */
export function sessionNameFor(nodeId: string): string {
  return `${SESSION_PREFIX}${nodeId}`
}

export interface TmuxConfig {
  tmuxPath: string
  socketPath: string
  configPath: string
  /** e.g. ["-L", "termsprawl", "-f", "/path/tmux.conf"] — prefix every tmux call. */
  baseArgs: string[]
}

/**
 * Ensure the dedicated socket dir + generated config exist.
 * Status bar off, mouse on, 50k history, clipboard via OSC 52 (terminal-features
 * is the bit that actually enables it on tmux 3.2+).
 */
export function ensureTmuxConfig(userDataPath: string): TmuxConfig | null {
  const tmuxPath = findTmux()
  if (!tmuxPath) return null

  const socketDir = join(userDataPath, 'tmux-sockets')
  mkdirSync(socketDir, { recursive: true })
  const socketPath = join(socketDir, TMUX_SOCKET)
  const configPath = join(userDataPath, 'tmux.conf')

  const conf = [
    'set -g status off',
    'set -g mouse on',
    'set -g history-limit 50000',
    'set -g set-clipboard on',
    'set -ga terminal-features ",*:clipboard"',
    'set -g escape-time 10',
    '',
    // copy-mode selection copies to the system clipboard via OSC 52.
    // MUST use the `send-keys -X` wrapper: on tmux 3.4 a bare
    // `copy-pipe-and-cancel` binding puts the pane into copy mode at startup
    // (pane_in_mode=1), which swallows all keyboard input.
    'bind -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel',
    'bind -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel',
    ''
  ].join('\n')
  writeFileSync(configPath, conf, 'utf8')

  // -S takes an absolute socket path (-L takes a NAME relative to
  // /tmp/tmux-<uid>/, which may not exist and fails silently).
  return { tmuxPath, socketPath, configPath, baseArgs: ['-S', socketPath, '-f', configPath] }
}

/** True when a session for this node id already exists (warm reattach). */
export function hasSession(tmux: TmuxConfig, nodeId: string): boolean {
  try {
    const { execFileSync } = require('node:child_process')
    execFileSync(tmux.tmuxPath, [...tmux.baseArgs, 'has-session', '-t', sessionNameFor(nodeId)], {
      stdio: 'ignore',
      timeout: 2000
    })
    return true
  } catch {
    return false
  }
}
