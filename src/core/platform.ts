// The seam the core talks through. Electron implements it in the main process;
// the Server Edition implements it over WebSockets; tests implement a stub.
// The core must NEVER import electron (enforced by no-electron.test.ts).

export interface CorePlatform {
  /** Push an event to the renderer (or server clients). */
  broadcast(channel: string, payload: unknown): void
}
