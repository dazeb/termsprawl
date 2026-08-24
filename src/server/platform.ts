// Server Edition platform — the CorePlatform seam implemented over WebSockets.
// Downstream events (pty data/exit, agent status, update status) are pushed to
// every connected browser client. Electron-free.

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CorePlatform } from '../core/platform'

/** Default server data dir (tmux config/sockets, scrollback, settings, index). */
export function defaultServerDataPath(): string {
  return process.env.TERMSPRAWL_DATA ?? join(homedir(), '.config', 'termsprawl')
}

export class ServerPlatform implements CorePlatform {
  readonly userDataPath: string
  private readonly sendAll: (channel: string, payload: unknown) => void

  constructor(
    sendAll: (channel: string, payload: unknown) => void,
    userDataPath: string = defaultServerDataPath()
  ) {
    this.sendAll = sendAll
    this.userDataPath = userDataPath
  }

  broadcast(channel: string, payload: unknown): void {
    this.sendAll(channel, payload)
  }
}
