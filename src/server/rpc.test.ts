// Server Edition RPC dispatcher — pure, no network. Maps a method name to a
// handler and returns a response envelope. The node:http + ws layer is a thin
// shell over this, so the routing logic stays unit-testable.

import { describe, expect, it } from 'vitest'
import { createDispatcher, type RpcRequest } from './rpc'

function req(partial: Partial<RpcRequest>): RpcRequest {
  return { id: 1, method: 'noop', args: [], ...partial }
}

describe('createDispatcher', () => {
  it('dispatches to a handler and passes its args', async () => {
    let captured: unknown[] | undefined
    const dispatch = createDispatcher({
      echo: (args) => {
        captured = args
        return args
      }
    })
    const res = await dispatch(req({ method: 'echo', args: ['a', 2] }))
    expect(res).toEqual({ id: 1, ok: true, result: ['a', 2] })
    expect(captured).toEqual(['a', 2])
  })

  it('returns an error envelope for an unhandled method', async () => {
    const dispatch = createDispatcher({})
    const res = await dispatch(req({ method: 'nope' }))
    expect(res).toEqual({ id: 1, ok: false, error: 'unhandled: nope' })
  })

  it('catches a throwing handler into an error envelope', async () => {
    const dispatch = createDispatcher({
      boom: () => {
        throw new Error('kaboom')
      }
    })
    const res = await dispatch(req({ method: 'boom' }))
    expect(res?.ok).toBe(false)
    expect(res?.error).toContain('kaboom')
  })

  it('ignores a malformed message (no method)', async () => {
    const dispatch = createDispatcher({})
    const res = await dispatch({ id: 1 })
    expect(res).toBeNull()
  })
})
