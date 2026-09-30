# A2A and local agent messaging

Follow the repository root AGENTS.md. This directory is Electron-free.

- `protocol.ts` and `client.ts`: external-peer discovery and sending.
- `messaging.ts`: per-node local cards, directed link authorization, private
  persistent tasks, automatic delivery, and participant-scoped replies.
- `tool-rpc.ts`: A2A 0.3 JSON-RPC facade over the authenticated MCP/CLI tools.

The authenticated session supplies caller identity. Message metadata must
never supply a caller/project identity or grant access. Existing transcript
links do not authorize requests: require `config.agentMessages === true`.
Delivery acknowledgement and a completed model task are different results.
Keep protocol support explicit; streaming and public network exposure are
not implied by local agent cards. Test authorization, retries, restart
recovery, and real HTTP behavior before changing the broker.
