// Server Edition agent-status bridge — reuses the electron-free HookServer
// (core) and broadcasts normalized lifecycle events to browser clients over
// WS on agent:status:<sessionId>, mirroring the desktop main process.

import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAgentBridge, type AgentBridge } from './agent-bridge'
import type { CorePlatform } from '../core/platform'

function makePlatform(broadcast: (c: string, p: unknown) => void): CorePlatform {
  return { userDataPath: '/tmp', broadcast }
}

describe('server agent bridge', () => {
  let bridge: AgentBridge | null = null

  afterEach(() => {
    bridge?.stop()
    bridge = null
  })

  it('broadcasts a normalized claude hook over agent:status:<sessionId>', async () => {
    const broadcast = vi.fn()
    bridge = await startAgentBridge(makePlatform(broadcast))

    const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'abc', tool_name: 'Bash' })
    await new Promise<void>((resolve, reject) => {
      const req = request(
        `${bridge!.hookUrl}hook/claude`,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          res.resume()
          res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`status ${res.statusCode}`))))
        }
      )
      req.on('error', reject)
      req.write(payload)
      req.end()
    })

    // The hook handler normalizes + broadcasts asynchronously after res.end().
    await new Promise((r) => setTimeout(r, 60))

    expect(broadcast).toHaveBeenCalled()
    const [channel, event] = broadcast.mock.calls[0]
    expect(channel).toBe('agent:status:abc')
    expect(event).toMatchObject({ sessionId: 'abc', status: 'working', kind: 'session' })
  })

  it('is fail-open: a malformed payload returns 200 and does not broadcast', async () => {
    const broadcast = vi.fn()
    bridge = await startAgentBridge(makePlatform(broadcast))

    await new Promise<void>((resolve, reject) => {
      const req = request(
        `${bridge!.hookUrl}hook/claude`,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          res.resume()
          res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`status ${res.statusCode}`))))
        }
      )
      req.on('error', reject)
      req.write('{not json')
      req.end()
    })

    await new Promise((r) => setTimeout(r, 60))
    expect(broadcast).not.toHaveBeenCalled()
  })
})
