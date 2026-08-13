import { contextBridge, ipcRenderer } from 'electron'

// The narrow API surface exposed to the renderer as window.termsprawl.
// Grows per phase; the renderer must never touch ipcRenderer directly.
const api = {
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

contextBridge.exposeInMainWorld('termsprawl', api)

export type TermsprawlApi = typeof api
