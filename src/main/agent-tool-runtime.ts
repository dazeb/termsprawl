import { BrowserWindow, ipcMain, webContents, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { IPC } from '../shared/ipc'
import { AGENT_REGISTRY, type AgentId } from '../shared/agents/config'
import type { PtyCreateRequest, SerializedNode, SettingsMcpServer } from '../shared/types'
import type { CorePlatform } from '../core/platform'
import type { PtyManager } from '../core/pty-manager'
import type { WorkspaceStore } from '../core/workspace-store'
import { AgentToolServer, privateJson } from '../core/agent-tool-server'
import { installToolRuntime, prepareToolLaunch, probeAgent } from '../core/agent-tool-launch'
import { externalTerminalCommand, launchExternalTerminal, type ExternalTerminalConfig } from '../core/agent-tool-external'
import type { CanvasToolReply, IntegrationStatus, ToolIdentity, ToolRequest } from '../core/agent-tools'
import { createRealContextIO, runContextCli } from '../core/context-cli'
import { classifyFile } from '../core/file-service'
import { normalizeAddress } from '../core/browser-policy'
import { guestIdForNode } from './browser/manager'

interface Preferences { externalTerminal?: ExternalTerminalConfig; custom?: { executable: string; instructionFlag?: string } }
type Pending = { senderId: number; finish(reply: CanvasToolReply['result']): void }

/** Desktop implementation: all canvas mutations go through the renderer's state owner. */
export class AgentToolRuntime {
  readonly server: AgentToolServer
  private launcher = ''
  private pending = new Map<string, Pending>()
  private statuses = new Map<string, IntegrationStatus>()
  private owners = new Map<string, string>()
  private active = new Set<string>()
  private stopping = false

  constructor(private readonly platform: CorePlatform, private readonly workspace: WorkspaceStore, private readonly pty: PtyManager, private readonly browserEnabled: () => boolean, appVersion?: string) {
    this.server = new AgentToolServer(platform.userDataPath, {
      browserEnabled,
      appVersion,
      valid: (identity) => {
        const snapshot = workspace.snapshot()
        return snapshot.index.projects.some((p) => p.id === identity.projectId && !p.remote) &&
          (this.active.has(identity.nodeId) || (snapshot.projects[identity.projectId] ?? []).some((n) => n.id === identity.nodeId))
      },
      execute: (identity, request) => this.execute(identity, request),
      onStatus: (nodeId, status) => { this.statuses.set(nodeId, status); platform.broadcast(IPC.agentToolStatus, { nodeId, status }) }
    })
    try {
      const owners = JSON.parse(readFileSync(join(this.server.directory, 'browser-owners.json'), 'utf8'))
      if (owners && typeof owners === 'object') for (const [node, owner] of Object.entries(owners)) if (typeof owner === 'string') this.owners.set(node, owner)
    } catch { /* First boot. */ }
  }

  private preferences(): Preferences {
    const path = join(this.server.directory, 'preferences.json')
    if (!existsSync(path)) return {}
    try { return JSON.parse(readFileSync(path, 'utf8')) as Preferences } catch { throw new Error('Invalid agent-tools/preferences.json') }
  }

  mcpInventory(): SettingsMcpServer[] {
    return [...this.statuses].filter(([, status]) => status.adapter.endsWith('-mcp')).map(([nodeId, status]) => ({
      id: `termsprawl:${nodeId}`, name: `termsprawl (${nodeId})`, agent: status.adapter.replace('-mcp', ''), transport: 'stdio',
      detail: 'Bundled canvas, browser and terminal tools — supplied at agent launch', configPath: join(this.server.directory, 'launch', nodeId)
    }))
  }

  async start(executable: string, bundle: string): Promise<void> {
    await this.server.start()
    this.launcher = installToolRuntime(this.server.directory, executable, bundle)
    ipcMain.on(IPC.agentToolReply, (event, reply: CanvasToolReply) => {
      const pending = this.pending.get(reply?.requestId)
      if (pending && event.sender.id === pending.senderId && event.senderFrame === event.sender.mainFrame) pending.finish(reply.result)
    })
    ipcMain.handle(IPC.agentToolStatusGet, (_event, nodeId: string) => this.statuses.get(nodeId) ?? null)
  }

  prepare(req: PtyCreateRequest): { request: PtyCreateRequest; command?: string } {
    if (req.remote || !req.projectId || !req.command) return { request: req }
    const match = /^(\S+)(.*)$/s.exec(req.command.trim())
    if (!match) return { request: req }
    const agent = req.agentId && Object.hasOwn(AGENT_REGISTRY, req.agentId) ? AGENT_REGISTRY[req.agentId] : Object.values(AGENT_REGISTRY).find((a) => a.command === match[1])
    if (!agent || (agent.id === 'claude' && /\bauth\s+login\b|\/login/.test(match[2]))) return { request: req }
    const identity = { nodeId: req.id, projectId: req.projectId }
    this.active.add(req.id)
    const warm = this.pty.isWarm(req.id)
    const existing = this.server.hasCredentials(req.id)
    const custom = agent.id === 'custom' ? this.preferences().custom : undefined
    const probe = probeAgent(custom?.executable ?? agent.command)
    let status: IntegrationStatus
    if (!probe) {
      status = { state: 'needs-setup', adapter: agent.id, version: 'unknown', reason: 'Agent executable was not found' }
      this.server.provision(identity, status, false)
      return { request: req }
    }
    const prepared = prepareToolLaunch({ probe, commandTail: match[2], directory: join(this.server.directory, 'launch', req.id), sessionFile: this.server.sessionFile(req.id), launcher: this.launcher, customInstructionFlag: custom?.instructionFlag })
    status = warm && !existing ? { ...prepared.status, state: 'needs-setup', reason: 'This running session predates tool integration. Close it and launch a new agent when ready.' } : prepared.status
    this.server.provision(identity, status, warm && existing)
    return { request: { ...req, env: { ...req.env, ...prepared.env, TERMSPRAWL_NODE_ID: req.id, TERMSPRAWL_PROJECT_ID: req.projectId } }, command: prepared.command }
  }

  revoke(nodeId: string): void {
    if (this.stopping) return // App quit detaches tmux clients; it must not revoke warm sessions.
    this.active.delete(nodeId)
    this.server.revoke(nodeId)
    const previous = this.statuses.get(nodeId)
    this.statuses.delete(nodeId)
    if (previous) this.platform.broadcast(IPC.agentToolStatus, { nodeId, status: { ...previous, state: 'needs-setup', reason: 'The agent session ended; launch a new agent to reconnect.' } })
    for (const [browser, owner] of this.owners) if (owner === nodeId) this.owners.delete(browser)
    this.saveOwners()
  }

  private saveOwners(): void { privateJson(join(this.server.directory, 'browser-owners.json'), Object.fromEntries(this.owners)) }

  private canvas(identity: ToolIdentity, request: ToolRequest): Promise<unknown> {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')) ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.hostWebContents)
    if (!win) return Promise.reject(new Error('Canvas is not available'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Canvas did not acknowledge the operation. Inspect the canvas before retrying.')) }, 10_000)
      this.pending.set(requestId, { senderId: win.webContents.id, finish: (result) => {
        clearTimeout(timer)
        this.pending.delete(requestId)
        if (result?.ok) resolve(result.value)
        else reject(new Error(result?.error ?? 'Invalid canvas reply'))
      } })
      win.webContents.send(IPC.agentToolRequest, { ...request, requestId, projectId: identity.projectId, expiresAt: Date.now() + 9000 })
    })
  }

  private async guest(node: SerializedNode): Promise<WebContents> {
    const data = node.data as { activeTabId?: string; tabs?: Array<{ id: string }> }
    const tabId = data.activeTabId ?? data.tabs?.[0]?.id
    for (let attempt = 0; attempt < 60; attempt++) {
      const id = guestIdForNode(node.id, tabId)
      const guest = id === undefined ? undefined : webContents.fromId(id)
      if (guest && !guest.isDestroyed()) return guest
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Browser target is not ready or was closed')
  }

  private async execute(identity: ToolIdentity, request: ToolRequest): Promise<unknown> {
    const { operation, args } = request
    const snapshot = this.workspace.snapshot()
    const project = snapshot.index.projects.find((p) => p.id === identity.projectId)
    if (!project || project.remote) throw new Error('Local project not found')
    const nodes = await this.canvas(identity, { operation: 'canvas_list', args: {} }) as SerializedNode[]
    if (!nodes.some((n) => n.id === identity.nodeId)) throw new Error('Agent node is no longer on this canvas')
    const node = nodes.find((n) => n.id === args.nodeId)
    if (operation === 'canvas_list') return nodes
    if (operation === 'context_read') {
      if (!project.cwd) return { text: '', reason: 'Linked transcripts require a folder project' }
      const io = createRealContextIO(project.cwd)
      let text = ''
      runContextCli({ cwd: project.cwd, self: identity.nodeId }, { ...io, print: (value) => { text = value } })
      return { text: text.slice(-100_000), reader: 'claude-jsonl', reason: text ? undefined : 'No readable linked transcripts' }
    }
    if (operation === 'artifact_open') {
      if (!project.cwd || !isAbsolute(String(args.path))) throw new Error('Use an absolute file path inside a folder project')
      const path = realpathSync(String(args.path))
      const inside = relative(realpathSync(project.cwd), path)
      if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Artifact must be inside this project')
      if (classifyFile(path) === 'binary') throw new Error('This format has no built-in preview (including video). Use a web preview URL when available.')
      if (args.view === 'diff' && classifyFile(path) === 'image') throw new Error('Image diffs are not supported')
      args.path = path
    }
    if (operation === 'agent_launch') {
      const preset = AGENT_REGISTRY[args.agent as AgentId]
      const command = preset.id === 'custom' ? this.preferences().custom?.executable : preset.command
      if (!command || !probeAgent(command)) throw new Error('Install or configure this agent before launching it')
    }
    if (operation === 'browser_open' || operation === 'browser_navigate') {
      const url = normalizeAddress(String(args.url))
      if (!url) throw new Error('Browser URL is not allowed')
      args.url = url
    }
    if (operation === 'browser_list') return nodes.filter((n) => n.type === 'browser').map((n) => ({ ...n, owner: this.owners.get(n.id) ?? null }))
    if (operation === 'browser_open') {
      const result = await this.canvas(identity, request) as { nodeId: string; tabId: string }
      this.owners.set(result.nodeId, identity.nodeId)
      this.saveOwners()
      const guest = await this.guest({ id: result.nodeId, data: { activeTabId: result.tabId } } as unknown as SerializedNode)
      return { ...result, targetId: `webcontents:${guest.id}` }
    }
    if (operation.startsWith('browser_')) {
      if (!node || node.type !== 'browser') throw new Error('Browser node not found in this project')
      const owner = this.owners.get(node.id)
      if (operation === 'browser_claim') {
        if (owner && owner !== identity.nodeId) throw new Error('Ask the current owner to transfer browser control')
        this.owners.set(node.id, identity.nodeId); this.saveOwners()
        return { nodeId: node.id, owner: identity.nodeId }
      }
      if (owner !== identity.nodeId) throw new Error('Claim this browser or ask its owner to transfer control first')
      if (operation === 'browser_transfer') {
        if (!this.server.statuses(identity.projectId).some((s) => s.nodeId === args.agentNodeId)) throw new Error('Recipient agent is not connected to this project')
        this.owners.set(node.id, String(args.agentNodeId)); this.saveOwners()
        return { nodeId: node.id, owner: args.agentNodeId }
      }
      const guest = await this.guest(node)
      if (!this.browserEnabled()) throw new Error('Browser control was disabled')
      return this.browserOperation(guest, request)
    }
    if (operation.startsWith('terminal_') && operation !== 'terminal_open') {
      if (!node || node.type !== 'terminal' || (node.data as { relayTerm?: string }).relayTerm) throw new Error('Local terminal not found in this project')
      if (node.id === identity.nodeId && operation !== 'terminal_read' && operation !== 'terminal_external') throw new Error('Use a separate shell terminal instead of writing into or closing your own agent')
      if (operation === 'terminal_read') {
        const output = this.pty.capturePane(node.id) ?? this.pty.readScrollback(node.id)
        if (output === null) throw new Error('Terminal output is unavailable; tmux is required for capture')
        return { nodeId: node.id, output: output.slice(-Math.max(1, Math.min(100_000, Number(args.maxChars ?? 16_000)))) }
      }
      if (operation === 'terminal_external') {
        const tmux = this.pty.localTmux()
        if (!tmux || !this.pty.isWarm(node.id)) throw new Error('A running managed tmux session is required')
        await launchExternalTerminal(externalTerminalCommand(tmux, node.id, this.preferences().externalTerminal))
        return { nodeId: node.id, attached: true }
      }
      if (operation === 'terminal_close') return this.canvas(identity, request)
      if (!this.pty.hasLiveSession(node.id)) throw new Error('Terminal is not attached')
      if (operation === 'terminal_submit' && (node.data as { command?: string }).command) throw new Error('Submit shell commands only to a plain shell terminal')
      this.pty.writeManaged(node.id, operation === 'terminal_interrupt' ? '\x03' : operation === 'terminal_submit' ? String(args.command) : String(args.text), operation === 'terminal_submit')
      return { nodeId: node.id, delivered: true }
    }
    const result = await this.canvas(identity, request)
    if (operation === 'terminal_open' || operation === 'agent_launch') {
      const id = (result as { nodeId: string }).nodeId
      for (let attempt = 0; attempt < 100 && !this.pty.hasReadySession(id); attempt++) await new Promise((resolve) => setTimeout(resolve, 50))
      if (!this.pty.hasReadySession(id)) throw new Error(`Node ${id} was created but its terminal did not become ready. Inspect it before retrying.`)
    }
    return result
  }

  private async browserOperation(guest: WebContents, request: ToolRequest): Promise<unknown> {
    const { operation, args } = request
    const work = async (): Promise<unknown> => {
      if (operation === 'browser_navigate') { await guest.loadURL(String(args.url)); return { url: guest.getURL() } }
      if (operation === 'browser_screenshot') return { image: (await guest.capturePage()).toPNG().toString('base64') }
      if (operation === 'browser_inspect') return guest.executeJavaScript(`(() => ({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,24000),controls:Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]')).filter(e=>e.getClientRects().length).slice(0,100).map(e=>({tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,120),selector:e.id?'#'+CSS.escape(e.id):e.tagName.toLowerCase()+(e.getAttribute('name')?'[name='+JSON.stringify(e.getAttribute('name'))+']':''),type:e.getAttribute('type')}))}))()`)
      const selector = JSON.stringify(args.selector)
      const expression = `(() => {const found=Array.from(document.querySelectorAll(${selector})).filter(e=>e.getClientRects().length);if(found.length!==1)throw new Error('Selector must match exactly one visible element');const e=found[0];e.scrollIntoView({block:'center'});${operation === 'browser_click'
        ? `const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`
        : `if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))throw new Error('Select an input or textarea');if(e.disabled||e.readOnly)throw new Error('Input is disabled or read only');e.focus();const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(args.text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {typed:true}`}})()`
      const result = await guest.executeJavaScript(expression)
      if (operation === 'browser_click') {
        guest.sendInputEvent({ type: 'mouseDown', x: result.x, y: result.y, button: 'left', clickCount: 1 })
        guest.sendInputEvent({ type: 'mouseUp', x: result.x, y: result.y, button: 'left', clickCount: 1 })
        return { clicked: true }
      }
      return result
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser operation timed out; inspect the page before retrying')), 15_000) })]) }
    finally { clearTimeout(timer) }
  }

  async close(): Promise<void> {
    this.stopping = true
    for (const [requestId, pending] of this.pending) pending.finish({ ok: false, error: `App stopped during request ${requestId}` })
    ipcMain.removeAllListeners(IPC.agentToolReply)
    ipcMain.removeHandler(IPC.agentToolStatusGet)
    await this.server.close()
  }
}
