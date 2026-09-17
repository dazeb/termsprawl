export interface ToolIdentity { nodeId: string; projectId: string }
export interface IntegrationStatus {
  state: 'connected' | 'cli-fallback' | 'needs-setup'
  adapter: string
  version: string
  reason: string
}
export interface ToolRequest { operation: string; args: Record<string, unknown> }
export type ToolResult = { ok: true; value: unknown } | { ok: false; error: string }
export interface CanvasToolRequest extends ToolRequest {
  requestId: string
  projectId: string
  expiresAt: number
}
export interface CanvasToolReply { requestId: string; result: ToolResult }
