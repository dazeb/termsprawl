import { describe, expect, it } from 'vitest'
import { applyUpdateEvent, idleUpdateStatus } from './update-status'

describe('applyUpdateEvent', () => {
  it('starts idle', () => {
    expect(idleUpdateStatus()).toEqual({ phase: 'idle' })
  })

  it('surfaces an available version', () => {
    expect(applyUpdateEvent(idleUpdateStatus(), { type: 'available', version: '0.3.4' })).toEqual({
      phase: 'available',
      version: '0.3.4'
    })
  })

  it('tracks download progress', () => {
    const next = applyUpdateEvent(
      { phase: 'available', version: '0.3.4' },
      { type: 'progress', percent: 42 }
    )
    expect(next).toEqual({ phase: 'downloading', version: '0.3.4', percent: 42 })
  })

  it('marks a downloaded update as ready to restart', () => {
    expect(
      applyUpdateEvent({ phase: 'downloading', version: '0.3.4', percent: 99 }, { type: 'ready' })
    ).toEqual({ phase: 'ready', version: '0.3.4' })
  })

  it('records an error without losing the last known version', () => {
    expect(
      applyUpdateEvent(
        { phase: 'downloading', version: '0.3.4', percent: 10 },
        { type: 'error', message: 'network' }
      )
    ).toEqual({ phase: 'error', version: '0.3.4', message: 'network' })
  })

  it('dismiss returns to idle', () => {
    expect(applyUpdateEvent({ phase: 'available', version: '0.3.4' }, { type: 'dismiss' })).toEqual({
      phase: 'idle'
    })
  })
})
