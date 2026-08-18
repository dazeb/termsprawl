export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  version?: string
  percent?: number
  message?: string
}

export type UpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'dismiss' }

export function idleUpdateStatus(): UpdateStatus {
  return { phase: 'idle' }
}

export function applyUpdateEvent(prev: UpdateStatus, event: UpdateEvent): UpdateStatus {
  switch (event.type) {
    case 'available':
      return { phase: 'available', version: event.version }
    case 'progress':
      return {
        phase: 'downloading',
        version: prev.version,
        percent: Math.max(0, Math.min(100, Math.round(event.percent)))
      }
    case 'ready':
      return { phase: 'ready', version: prev.version }
    case 'error':
      return { phase: 'error', version: prev.version, message: event.message }
    case 'dismiss':
      return idleUpdateStatus()
  }
}
