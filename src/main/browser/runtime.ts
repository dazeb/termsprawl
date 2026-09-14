// Browser-node runtime provisioning.
//
// SECURITY (audit 2026-09-06): the raw Chromium `--remote-debugging-port`
// exposed the MAIN window (with the full `window.termsprawl` preload bridge)
// to any local process on an unauthenticated random port — full arbitrary
// file read/write + shell RCE. The raw port is GONE. The only CDP surface is
// the facade (`src/main/browser/cdp-facade.ts`), which proxies guests only,
// and it now requires the per-boot token (see `startCdpFacade`).
//
// This module keeps the per-boot token + a fallback port so `browser:cdp-info`
// can report reality; it never puts `--remote-debugging-port` on Chromium's
// command line.

import { randomBytes } from 'node:crypto'

export const browserRuntime = {
  // No Chromium debug port is ever opened. Kept for the IPC contract
  // (browser:cdp-info consumers that expect a port field); 0 = none.
  port: 0,
  token: randomBytes(24).toString('hex'),
  wsUrl: ''
} as { port: number; token: string; wsUrl: string }