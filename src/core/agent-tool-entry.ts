import { createInterface } from 'node:readline'
import { AGENT_TOOLS, TOOL_GUIDES } from './agent-tools'
import { callAgentTool } from './agent-tool-client'

const argv = process.argv.slice(2)
const sessionIndex = argv.indexOf('--session')
const sessionFile = sessionIndex < 0 ? process.env.TERMSPRAWL_SESSION_FILE : argv.splice(sessionIndex, 2)[1]
if (!sessionFile) {
  process.stderr.write('Launch this helper from a termsprawl agent, or provide --session /absolute/path/to/session.json\n')
  process.exitCode = 2
} else if (argv[0] === 'mcp') {
  // MCP stdio uses one JSON-RPC message per line. Never log to stdout.
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    let id: unknown = null
    try {
      if (line.length > 256 * 1024) throw new Error('Message too large')
      const message = JSON.parse(line)
      id = message.id
      if (id === undefined) continue
      let result: unknown
      if (message.method === 'initialize') {
        const connected = await callAgentTool(sessionFile, { operation: 'session_info', args: {} })
        if (!connected.ok) throw new Error(connected.error)
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'termsprawl', version: (connected.value as { appVersion: string }).appVersion }, instructions: TOOL_GUIDES.overview }
      } else if (message.method === 'ping') result = {}
      else if (message.method === 'tools/list') result = { tools: AGENT_TOOLS }
      else if (message.method === 'tools/call') {
        const reply = await callAgentTool(sessionFile, { operation: message.params?.name, args: message.params?.arguments ?? {} })
        const value = reply.ok ? reply.value as { image?: string } | null : null
        result = { isError: !reply.ok, content: value?.image
          ? [{ type: 'image', data: value.image, mimeType: 'image/png' }]
          : [{ type: 'text', text: JSON.stringify(reply) }] }
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }) + '\n')
        continue
      }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
    } catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : 'Invalid request' } }) + '\n')
    }
  }
} else {
  try {
    if (argv[0] !== 'doctor' && argv[0] !== 'call') throw new Error('Usage: termsprawlctl doctor | call OPERATION [JSON_ARGS] | mcp')
    const reply = await callAgentTool(sessionFile, { operation: argv[0] === 'doctor' ? 'session_info' : argv[1], args: argv[2] ? JSON.parse(argv[2]) : {} })
    process.stdout.write(JSON.stringify(reply, null, 2) + '\n')
    if (!reply.ok) process.exitCode = 1
  } catch (error) { process.stderr.write(`${String(error)}\n`); process.exitCode = 2 }
}
