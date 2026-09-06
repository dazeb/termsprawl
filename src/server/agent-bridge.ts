// Server Edition agent-status bridge — reuses the electron-free HookServer
// (core) and broadcasts normalized lifecycle events to browser clients over WS
// on agent:status:<sessionId>, mirroring the desktop main process. Fail-open
// at the HTTP layer (the agent CLI never blocks on us), fail-closed on the
// shared hook key (audit B8.1 — a missing/wrong ?key= is never normalized).
//
// Also installs URL hooks for any available agent CLIs (claude, codex) so
// agent terminal nodes show RUNNING/NEEDS YOU status in the browser. Every
// installed hook carries the per-boot secret in its query string.

import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { HookServer } from '../core/hook-server'
import { installClaudeHooks, claudeSettingsPath } from '../core/hook-installer'
import { IPC } from '../shared/ipc'
import type { CorePlatform } from '../core/platform'

export interface AgentBridge {
  /** Loopback hook base URL (agent CLIs POST to `${hookUrl}hook/<agent>`). */
  hookUrl: string
  /** Hook URLs already carry `?key=`; expose the secret for any manual wiring. */
  hookSecret: string
  stop: () => void
}

/** Probe whether a CLI binary is on PATH (no shell, argv-array). */
function binOnPath(bin: string): boolean {
  try {
    return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/** Start the agent hook server and install hooks for available agent CLIs. */
export async function startAgentBridge(platform: CorePlatform): Promise<AgentBridge> {
  const hookServer = new HookServer((event) => {
    platform.broadcast(`${IPC.agentStatus}:${event.sessionId}`, event)
  })
  await hookServer.start()

  // Install URL hooks for any available agent CLIs on the server host.
  // claude: install URL hooks pointing at our loopback server. The per-boot
  // secret rides in ?key= so the loopback server accepts the POST (audit B8.1
  // fail-closed — keyless hooks are dropped silently).
  if (binOnPath('claude')) {
    try {
      installClaudeHooks(claudeSettingsPath(homedir()), hookServer.url, hookServer.secret)
      console.log(`[agent-bridge] claude hooks installed at ${claudeSettingsPath(homedir())}`)
    } catch (err) {
      console.error('[agent-bridge] failed to install claude hooks:', err)
    }
  }

  return {
    hookUrl: hookServer.url,
    hookSecret: hookServer.secret,
    stop: () => hookServer.stop()
  }
}