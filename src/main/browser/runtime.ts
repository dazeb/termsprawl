// Browser-node runtime provisioning. Owns the one per-session CDP endpoint
// that lets an external agent (Puppeteer / Playwright via connectOverCDP, or
// Hermes' browser tooling) drive the embedded browser guests. Called once at
// startup, before app.ready, so the --remote-debugging-port lands on the real
// argv (an appendSwitch-only approach would leave the debug port on a child
// process, mirroring the Wayland/ozone trap — see ../../AGENTS.md).
//
// SECURITY: the endpoint binds to 127.0.0.1 only (Chromium's default for the
// remote-debugging port), uses a random high port (never the well-known 9222),
// and every browser guest is additionally hardened by BrowserManager. The
// token is generated for a future gated proxy; pages inside the browser cannot
// reach 127.0.0.1 due to Chromium's Private Network Access. Residual risk is
// other local processes on the same user session — the same trust boundary the
// app already assumes.

import { app } from 'electron'
import { randomBytes } from 'node:crypto'

const DEBUG_FLAG = '--remote-debugging-port'

function randomHighPort(): number {
  return 49152 + Math.floor(Math.random() * 16000)
}

// Compute once at module load so the Wayland respawn in index.ts can use the
// SAME port value in the spawned child's argv, and the child won't re-roll it.
export const browserRuntime = {
  port: randomHighPort(),
  token: randomBytes(24).toString('hex'),
  // CDP http(s) endpoint (no trailing slash) for connectOverCDP / puppeteer.
  wsUrl: `http://127.0.0.1:${''}` // replaced below once port is final
} as { port: number; token: string; wsUrl: string }

browserRuntime.wsUrl = `http://127.0.0.1:${browserRuntime.port}`

/**
 * Put --remote-debugging-port=<random> on the command line. Call BEFORE
 * app.ready — after that the debug port is fixed for the process.
 *
 * When the flag is already on the real argv (the Wayland-respawn child carries
 * it, OR a user/agent passed --remote-debugging-port manually), we do NOT
 * append a second value; instead we reconcile browserRuntime to the port that
 * is actually in effect, so IPC (browser:cdp-info) always reports reality.
 */
export function ensureBrowserDebugPort(): void {
  const arg = process.argv.find((a) => a.startsWith(`${DEBUG_FLAG}=`))
  if (arg) {
    const parsed = Number(arg.slice(DEBUG_FLAG.length + 1))
    if (Number.isInteger(parsed) && parsed > 0) {
      browserRuntime.port = parsed
      browserRuntime.wsUrl = `http://127.0.0.1:${parsed}`
    }
    return
  }
  app.commandLine.appendSwitch('remote-debugging-port', String(browserRuntime.port))
}
