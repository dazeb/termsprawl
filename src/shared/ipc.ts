// Channel names — single source of truth for every IPC channel.
// Never hardcode a channel string elsewhere.

export const IPC = {
  // App metadata
  appVersion: 'app:version',
  openExternal: 'shell:open-external',
  appSettingsGet: 'app:settings-get',
  appSettingsSet: 'app:settings-set',
  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateDismiss: 'update:dismiss',
  announcementGet: 'announcement:get',

  // Workspace / projects (Phase 5)
  workspaceSnapshot: 'workspace:snapshot',
  workspaceSaveNodes: 'workspace:save-nodes',
  projectAdd: 'project:add',
  /** Import a project with a caller-supplied id (snapshot restore keeps ids
   * stable across machines); rejects when the id already exists. */
  projectImport: 'project:import',
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
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileList: 'file:list',

  // Agent hooks (Phase 7)
  agentStatus: 'agent:status', // suffixed ':<sessionId>' for the push channel
  agentSessionName: 'agent:session-name', // suffixed ':<sessionId>' for the push channel

  // Context links (Phase 7, 7.5)
  contextLinkList: 'context:list',
  contextLinkAdd: 'context:add',
  contextLinkRemove: 'context:remove',

  // Managed accounts (Phase 7, 7.6)
  accountCreate: 'app:account-create',
  accountDelete: 'app:account-delete',
  permissionProbe: 'app:permission-probe',
  loginCommand: 'app:login-command',

  // Source control (Phase 8)
  gitSnapshot: 'git:snapshot',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitCommitMessage: 'git:commit-message',
  gitCreateBranch: 'git:branch-create',
  gitCheckout: 'git:branch-checkout',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitPublish: 'git:publish',
  gitWorktrees: 'git:worktrees',
  gitWorktreeAdd: 'git:worktree-add',
  gitWorktreeRemove: 'git:worktree-remove',

  // Termsprawl Cloud — in-app GitHub sign-in (device flow) + backup
  cloudStatus: 'cloud:status',
  cloudDeviceStart: 'cloud:device-start',
  cloudDevicePoll: 'cloud:device-poll',
  cloudSignOut: 'cloud:sign-out',
  cloudBackupNow: 'cloud:backup-now',
  cloudListBackups: 'cloud:list-backups',
  // Online canvas spaces (Phase — online canvas spaces): status read + the
  // Pro-gated open (main mints the access token and opens the system browser).
  cloudSpaceStatus: 'cloud:space-status',
  cloudSpaceOpen: 'cloud:space-open',
  // Desktop sync loop (D1+D2): pull the space snapshot and import it as a NEW
  // local project; push the ACTIVE project's nodes + scrollbacks back up.
  cloudSpacePull: 'cloud:space-pull',
  cloudSpacePush: 'cloud:space-push',

  // Embedded browser node (Phase — browser node). The debug endpoint lets an
  // external agent drive the embedded guests; register maps a node id to its
  // guest, navigate centralises the URL policy.
  browserCdpInfo: 'browser:cdp-info',
  browserRegister: 'browser:register',
  browserUnregister: 'browser:unregister',
  browserNavigate: 'browser:navigate',
  // Push channel main → renderer when an external agent asks to open a browser
  // node (from the reachable loopback agent-control server).
  browserAgentOpen: 'browser:agent-open',

  // Chat driver v2 (Phase 11 Task 11.4). chatEvent is a push channel suffixed
  // ':<nodeId>'; send/stop/approve are invokes handled by the platform shim
  // (Electron main or the Server Edition WS-RPC handlers).
  chatSend: 'chat:send',
  chatStop: 'chat:stop',
  chatApprove: 'chat:approve',
  chatEvent: 'chat:event',

  // Relay seam (Phase 11 Task 11.2). Minimal surface: the app can dial the
  // relay and report status; pairing UI + terminal frames are follow-ups.
  relayConnect: 'relay:connect',
  relayDisconnect: 'relay:disconnect',
  relayStatus: 'relay:status',
  // Frames flow only while the renderer holds an onFrame subscriber (audit B7).
  relayFrameSubscribe: 'relay:frame:subscribe',
  relayFrameUnsubscribe: 'relay:frame:unsubscribe'
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

export function chatEventChannel(nodeId: string): string {
  return `${IPC.chatEvent}:${nodeId}`
}
