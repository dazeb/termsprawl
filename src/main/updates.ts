// Packaged-app update checks via electron-updater + GitHub Releases.
// Dev / unpackaged builds no-op so `pnpm run dev` never hits the feed.

import electronUpdater from 'electron-updater'
import { IPC } from '../shared/ipc'
import {
  applyUpdateEvent,
  idleUpdateStatus,
  type UpdateEvent,
  type UpdateStatus
} from '../shared/update-status'

export interface UpdateBridge {
  status(): UpdateStatus
  check(): Promise<UpdateStatus>
  download(): Promise<UpdateStatus>
  install(): void
  setAutoDownload(enabled: boolean): void
  dismiss(): UpdateStatus
}

interface UpdateBridgeOptions {
  isPackaged: boolean
  autoDownload: boolean
  broadcast: (channel: string, payload: unknown) => void
}

export function createUpdateBridge(options: UpdateBridgeOptions): UpdateBridge {
  let status = idleUpdateStatus()

  const emit = (event: UpdateEvent): UpdateStatus => {
    status = applyUpdateEvent(status, event)
    options.broadcast(IPC.updateStatus, status)
    return status
  }

  if (!options.isPackaged) {
    return {
      status: () => status,
      check: async () => status,
      download: async () => status,
      install: () => undefined,
      setAutoDownload: () => undefined,
      dismiss: () => emit({ type: 'dismiss' })
    }
  }

  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = options.autoDownload
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    emit({ type: 'available', version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    emit({ type: 'progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', () => {
    emit({ type: 'ready' })
  })
  autoUpdater.on('error', (error) => {
    emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })

  return {
    status: () => status,
    check: async () => {
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      }
      return status
    },
    download: async () => {
      try {
        await autoUpdater.downloadUpdate()
      } catch (error) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      }
      return status
    },
    install: () => {
      autoUpdater.quitAndInstall()
    },
    setAutoDownload: (enabled) => {
      autoUpdater.autoDownload = enabled
    },
    dismiss: () => emit({ type: 'dismiss' })
  }
}
