// Server Edition agent-status bridge — reuses the electron-free HookServer
// (core) and broadcasts normalized lifecycle events to browser clients over WS
// on agent:status:<sessionId>, mirroring the desktop main process. Fail-open:
// the agent CLI never blocks on us.

import { HookServer } from '../core/hook-server'
import { IPC } from '../shared/ipc'
import type { CorePlatform } from '../core/platform'

export interface AgentBridge {
  /** Loopback hook base URL (agent CLIs POST to `${hookUrl}hook/<agent>`). */
  hookUrl: string
  stop: () => void
}

/** Start the agent hook server and broadcast normalized events over the platform. */
export async function startAgentBridge(platform: CorePlatform): Promise<AgentBridge> {
  const hookServer = new HookServer((event) => {
    platform.broadcast(`${IPC.agentStatus}:${event.sessionId}`, event)
  })
  await hookServer.start()
  return { hookUrl: hookServer.url, stop: () => hookServer.stop() }
}
