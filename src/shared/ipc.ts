// Channel names — single source of truth for every IPC channel.
// Never hardcode a channel string elsewhere.

export const IPC = {
  // App metadata
  appVersion: 'app:version',

  // Workspace / projects (Phase 5)
  workspaceSnapshot: 'workspace:snapshot',
  workspaceSaveNodes: 'workspace:save-nodes',
  projectAdd: 'project:add',
  projectClose: 'project:close',
  projectArchive: 'project:archive',
  projectReopen: 'project:reopen',
  projectDelete: 'project:delete',
  projectUpdateSettings: 'project:update-settings',
  projectRename: 'project:rename',
  dialogSelectFolder: 'dialog:select-folder',

  // Terminal sessions (Phase 2)
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyDestroy: 'pty:destroy',
  terminalClose: 'terminal:close',
  ptyReadScrollback: 'pty:read-scrollback',
  ptyData: 'pty:data', // suffixed ':<sessionId>' for the push channel
  ptyExit: 'pty:exit', // suffixed ':<sessionId>' for the push channel

  // Node services (Phase 6)
  diffInfo: 'diff:info',
  dialogOpenFile: 'dialog:open-file',

  // Agent hooks (Phase 7)
  agentStatus: 'agent:status', // suffixed ':<sessionId>' for the push channel
  agentSessionName: 'agent:session-name' // suffixed ':<sessionId>' for the push channel
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export function ptyDataChannel(sessionId: string): string {
  return `${IPC.ptyData}:${sessionId}`
}

export function ptyExitChannel(sessionId: string): string {
  return `${IPC.ptyExit}:${sessionId}`
}

export function agentSessionNameChannel(sessionId: string): string {
  return `${IPC.agentSessionName}:${sessionId}`
}
