import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentToolServer } from './agent-tool-server'
import { callAgentTool } from './agent-tool-client'
import { validateToolRequest, type IntegrationStatus, type ToolIdentity, type ToolRequest } from './agent-tools'

const status: IntegrationStatus = { state: 'needs-setup', adapter: 'codex-mcp', version: 'test', reason: 'Waiting' }
const roots: string[] = []
const servers: AgentToolServer[] = []
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function root(): string { const path = mkdtempSync(join(tmpdir(), 'termsprawl tools ')); roots.push(path); return path }
function make(path = root(), execute: (identity: ToolIdentity, request: ToolRequest) => Promise<unknown> = vi.fn(async (identity, request) => ({ identity, request }))) {
  const server = new AgentToolServer(path, { execute, valid: () => true, browserEnabled: () => true })
  servers.push(server)
  return server
}

describe('agent tool transport', () => {
  it('binds credentials to an identity and validates arguments', async () => {
    const server = make()
    await server.start()
    server.provision({ nodeId: 'agent-1', projectId: 'project-1' }, status, false)
    const file = server.sessionFile('agent-1')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const reply = await callAgentTool(file, { operation: 'terminal_read', args: { nodeId: 'terminal-2' } })
    expect(reply).toMatchObject({ ok: true, value: { identity: { nodeId: 'agent-1', projectId: 'project-1' } } })
    expect(JSON.stringify(reply)).not.toContain('token')
    expect(await callAgentTool(file, { operation: 'terminal_read', args: { nodeId: 'terminal-2', projectId: 'other' } })).toMatchObject({ ok: false, error: 'Unknown argument: projectId' })
    const endpoint = JSON.parse(readFileSync(join(server.directory, 'endpoint.json'), 'utf8'))
    const response = await fetch(endpoint.url, { method: 'POST', headers: { authorization: 'Bearer forged' }, body: '{}' })
    expect(response.status).toBe(401)
  })

  it('reconnects with stable credentials and a newly discovered port after restart', async () => {
    const path = root()
    const first = make(path)
    await first.start()
    const session = first.provision({ nodeId: 'a', projectId: 'p' }, status, false)
    await first.close()
    const second = make(path)
    await second.start()
    expect(second.provision(session, status, true).token).toBe(session.token)
    expect(await callAgentTool(second.sessionFile('a'), { operation: 'session_info', args: {} })).toMatchObject({ ok: true, value: { instanceId: second.instanceId, status: { state: 'connected' } } })
    second.revoke('a')
    expect(await callAgentTool(second.sessionFile('a'), { operation: 'session_info', args: {} })).toMatchObject({ ok: false })
    expect(second.provision(session, status, false).token).not.toBe(session.token)
  })

  it('isolates app instances and refuses a second service using the same directory', async () => {
    const path = root()
    const first = make(path)
    const second = make()
    await first.start(); await second.start()
    const one = first.provision({ nodeId: 'same-id', projectId: 'p' }, status, false)
    second.provision({ nodeId: 'same-id', projectId: 'p' }, status, false)
    const endpoint = JSON.parse(readFileSync(join(second.directory, 'endpoint.json'), 'utf8'))
    expect((await fetch(endpoint.url, { method: 'POST', headers: { authorization: `Bearer ${one.token}` }, body: '{}' })).status).toBe(401)
    await expect(make(path).start()).rejects.toThrow('already using')
  })

  it('serializes mutations in a project and rechecks revocation after waiting', async () => {
    let unblock!: () => void
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    const execute = vi.fn(async () => { await gate; return 'done' })
    const server = make(root(), execute)
    const session = server.provision({ nodeId: 'a', projectId: 'p' }, status, false)
    const one = server.invoke(session, { operation: 'canvas_list', args: {} })
    const two = server.invoke(session, { operation: 'canvas_list', args: {} })
    const rejected = expect(two).rejects.toThrow('revoked')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execute).toHaveBeenCalledTimes(1)
    server.revoke('a'); unblock()
    await one; await rejected
  })

  it('rejects browser tools when control is disabled', async () => {
    const server = new AgentToolServer(root(), { execute: vi.fn(), valid: () => true, browserEnabled: () => false })
    servers.push(server)
    const session = server.provision({ nodeId: 'a', projectId: 'p' }, status, false)
    await expect(server.invoke(session, { operation: 'browser_open', args: { url: 'https://example.com' } })).rejects.toThrow('Settings')
  })
})

describe('tool validation', () => {
  it('rejects unknown operations, missing IDs, nonfinite coordinates and oversized input', () => {
    for (const raw of [null, {}, { operation: 'made_up', args: {} }, { operation: 'terminal_read', args: {} }, { operation: 'canvas_move', args: { nodeId: 'n', x: Infinity, y: 0 } }, { operation: 'terminal_input', args: { nodeId: 'n', text: 'x'.repeat(64_001) } }, { operation: 'canvas_group', args: { nodeIds: [] } }]) expect(() => validateToolRequest(raw)).toThrow()
  })
})
