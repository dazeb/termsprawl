import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ToolEndpoint, ToolSession } from './agent-tool-server'
import type { ToolRequest, ToolResult } from './agent-tools'

/** Reload discovery on every call so a running agent survives an app restart. */
export async function callAgentTool(sessionFile: string, request: ToolRequest): Promise<ToolResult> {
  try {
    const session = JSON.parse(readFileSync(sessionFile, 'utf8')) as ToolSession
    const endpoint = JSON.parse(readFileSync(join(dirname(dirname(sessionFile)), 'endpoint.json'), 'utf8')) as ToolEndpoint
    const url = new URL(endpoint.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/call') throw new Error('Invalid local endpoint')
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(45_000) })
    return await response.json() as ToolResult
  } catch (error) {
    return { ok: false, error: `Tool connection unavailable: ${error instanceof Error ? error.message : String(error)}. Check that termsprawl is running. Mutations are not automatically retried.` }
  }
}
