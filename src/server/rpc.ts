// Server Edition RPC dispatcher. Maps a method (an IPC channel name) to a
// handler and returns a response envelope. Electron-free and network-free —
// the ws layer in index.ts is a thin shell over this.

export type RpcHandler = (args: unknown[]) => Promise<unknown> | unknown

export interface RpcRequest {
  id: number
  method: string
  args: unknown[]
}

export interface RpcResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

export type RpcDispatcher = (message: unknown) => Promise<RpcResponse | null>

export function createDispatcher(handlers: Record<string, RpcHandler>): RpcDispatcher {
  return async (message: unknown): Promise<RpcResponse | null> => {
    const req = message as RpcRequest | null
    if (!req || typeof req.method !== 'string') return null
    const handler = handlers[req.method]
    if (!handler) return { id: req.id, ok: false, error: `unhandled: ${req.method}` }
    try {
      const result = await handler(Array.isArray(req.args) ? req.args : [])
      return { id: req.id, ok: true, result }
    } catch (error) {
      return { id: req.id, ok: false, error: String(error) }
    }
  }
}
