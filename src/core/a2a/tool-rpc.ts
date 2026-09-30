// A2A 0.3 JSON-RPC facade over the same authenticated operations as MCP/CLI.
// The caller identity comes from its node token, never from message metadata.
import type { ToolRequest } from '../../shared/agent-tools'
import type { AgentCard, AgentTask } from './messaging'

export function toolAgentCard(card: AgentCard, baseUrl: string): object {
  return {
    protocolVersion: '0.3.0', name: card.name,
    description: `${card.preset} agent on the termsprawl canvas. Enabled directed links authorize automatic requests; replies are tracked as tasks.`,
    version: '1.0.0', url: `${baseUrl}/a2a/agents/${encodeURIComponent(card.nodeId)}`, preferredTransport: 'JSONRPC',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, security: [{ bearer: [] }],
    skills: [{ id: card.nodeId, name: card.name, description: `Send text work to this ${card.preset} session. Integration: ${card.integration.state}.`, tags: ['agent', card.preset] }]
  }
}

function protocolTask(task: AgentTask): object {
  return {
    kind: 'task', id: task.id, contextId: task.id,
    status: { state: task.state, timestamp: new Date(task.updatedAt).toISOString(),
      ...(task.state === 'failed' ? { message: { kind: 'message', role: 'agent', messageId: `${task.id}-error`, parts: [{ kind: 'text', text: task.response }] } } : {}) },
    history: [{ kind: 'message', role: 'user', messageId: task.messageId ?? task.id, taskId: task.id, contextId: task.id, parts: [{ kind: 'text', text: task.text }] }],
    ...(task.state === 'completed' ? { artifacts: [{ artifactId: `${task.id}-reply`, parts: [{ kind: 'text', text: task.response }] }] } : {})
  }
}

export async function agentRpc(targetId: string, raw: unknown, invoke: (request: ToolRequest) => Promise<unknown>): Promise<object> {
  const request = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | null
  const id = typeof request?.id === 'string' || typeof request?.id === 'number' ? request.id : null
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
  if (!request || request.jsonrpc !== '2.0' || id === null) return error(-32600, 'Invalid JSON-RPC request')
  if (request.method !== 'message/send' && request.method !== 'tasks/get') return error(-32601, 'Supported methods: message/send, tasks/get')
  try {
    const params = request.params as { message?: { kind?: unknown; role?: unknown; messageId?: unknown; taskId?: unknown; parts?: unknown }; id?: unknown } | null
    let task: AgentTask
    if (request.method === 'message/send') {
      const message = params?.message
      if (message?.kind !== 'message' || message.role !== 'user' || typeof message.messageId !== 'string' || message.taskId !== undefined ||
        !Array.isArray(message.parts) || !message.parts.length || !message.parts.every((part) => part?.kind === 'text' && typeof part.text === 'string')) {
        return error(-32602, 'Send a new user message with messageId and text parts')
      }
      const text = message.parts.map((part: { text: string }) => part.text).join('\n')
      task = await invoke({ operation: 'agent_send', args: { nodeId: targetId, text, messageId: message.messageId } }) as AgentTask
    } else {
      if (typeof params?.id !== 'string') return error(-32602, 'Task id is required')
      task = await invoke({ operation: 'agent_task', args: { taskId: params.id } }) as AgentTask
      if (task.targetNodeId !== targetId) return error(-32001, 'Task not found at this agent endpoint')
    }
    return { jsonrpc: '2.0', id, result: protocolTask(task) }
  } catch (err) {
    return error(-32000, err instanceof Error ? err.message : 'Agent operation failed')
  }
}
