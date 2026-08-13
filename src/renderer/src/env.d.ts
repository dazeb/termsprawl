import type { PtyCreateRequest, PtyCreateResult, PtyExitInfo } from '@shared/types'

// The shape of window.termsprawl as exposed by the preload bridge.
declare global {
  interface Window {
    termsprawl: {
      appVersion(): Promise<string>
      pty: {
        create(req: PtyCreateRequest): Promise<PtyCreateResult>
        write(id: string, data: string): void
        resize(id: string, cols: number, rows: number): void
        destroy(id: string): void
        readScrollback(id: string): Promise<string | null>
        onData(id: string, cb: (data: string) => void): () => void
        onExit(id: string, cb: (info: PtyExitInfo) => void): () => void
      }
    }
  }
}

export {}
