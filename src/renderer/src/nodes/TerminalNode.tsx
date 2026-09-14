import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@reactflow/node-resizer'
import type { Node, NodeProps } from 'reactflow'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { LinkHandles } from './LinkHandles'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeData } from '../state/workspace'
import type { ProjectRemote } from '@shared/types'
import { resumedSessionId } from '../state/workspace'
import { parseRelayTermFrame, type RelayTermFrame } from '../../../core/relay-term'
import { useCanvas } from '../canvas/Canvas'
import { useAgentStatuses } from '../state/agents'
import { useProjects } from '../state/projects'
import { useSafeResize } from '../hooks/useSafeResize'
import { HelpBadge } from '../components/HelpBadge'

// Status badge labels for agent nodes (Phase 7). Only nodes spawned with a
// command (agent presets like claude/codex, druk) can carry a status.
const STATUS_LABEL: Record<string, string> = {
  working: 'RUNNING',
  waiting: 'NEEDS YOU',
  blocked: 'BLOCKED',
  done: 'DONE'
}

/** Owning project's remote destination (Phase 9), or undefined for a local
 * project or an unowned terminal. Read from the live projects store. */
function getOwningRemote(projectId: string | null): ProjectRemote | undefined {
  if (!projectId) return undefined
  return useProjects.getState().projects.find((p) => p.id === projectId)?.remote
}

// One terminal session, rendered with xterm, as a React Flow custom node.
// The PTY session id IS the React Flow node id — keep ids stable or the
// session respawns. The body is nodrag so xterm owns mouse input; dragging
// happens via the header (the drag handle). The × button asks Canvas to
// destroy the tmux session; ordinary React unmount only detaches the view.
export function TerminalNode({ id, data, selected }: NodeProps<TerminalNodeData>): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  // The xterm instance + fit addon live inside the mount effect; the resize
  // hook below reads them through refs so layout stays rAF-deferred (no RO
  // loop warning) while the effect owns their lifecycle.
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const { closeNode, updateNodeData } = useCanvas()
  const projectId = useProjects((s) => s.activeProjectId)
  // Capture ownership for this mount. During a project switch Zustand updates
  // before Canvas replaces its old nodes; reacting to that transient value
  // would destroy and recreate the outgoing project's PTYs under the new id.
  const ownerProjectIdRef = useRef(projectId)
  const agentStatus = useAgentStatuses((s) => s.byId[id])
  const setAgentStatus = useAgentStatuses((s) => s.set)
  const clearAgentStatus = useAgentStatuses((s) => s.clear)
  const hasUnread = useAgentStatuses((s) => s.unread[id] === true)
  const clearUnread = useAgentStatuses((s) => s.clearUnread)
  const [agentHint, setAgentHint] = useState(false)
  const [terminalSettings, setTerminalSettings] = useState({ fontFamily: 'Geist Mono, JetBrains Mono, monospace', profile: '' })
  useEffect(() => { void window.termsprawl.settings.get().then((s) => setTerminalSettings({ fontFamily: s.terminalFontFamily ?? 'Geist Mono, JetBrains Mono, monospace', profile: s.terminalProfile ?? '' })) }, [])
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.title)
  // B3 — a remote relay terminal (data.relayTerm set) mirrors a HOST terminal
  // over the tunnel instead of spawning a local pty.
  const isRemote = typeof data.relayTerm === 'string' && (data.relayTerm as string).length > 0
  const [relayStatus, setRelayStatus] = useState<string>('disconnected')
  const attachedRef = useRef(false)

  // Agent nodes (spawned with a command) subscribe to hook status. Only claude
  // pins session-id = node id today; others never receive events (fail-open).
  // A resume node additionally subscribes to the ORIGINAL session id — hook
  // events for a resumed conversation carry the old session id.
  useEffect(() => {
    if (!data.command) return
    setAgentHint(true)
    const resumed = resumedSessionId(data.command)
    const ids = resumed ? [id, resumed] : [id]
    const offs = ids.map((sid) =>
      window.termsprawl.agent.onStatus(sid, (event) => {
        // Lifecycle-only events (status absent — codex session pings) do not
        // touch the badge; the session is alive but nothing changed.
        if (event.status === undefined) return
        setAgentStatus(sid, event.status)
      })
    )
    return () => {
      offs.forEach((off) => off())
      clearAgentStatus(id)
      if (resumed) clearAgentStatus(resumed)
    }
  }, [id, data.command, setAgentStatus, clearAgentStatus])

  // Session-name sync (Task 7.4): when the agent's transcript reveals a
  // (possibly /rename'd) session name, mirror it into the node title.
  useEffect(() => {
    if (!data.command) return
    const resumed = resumedSessionId(data.command)
    const ids = resumed ? [id, resumed] : [id]
    const offs = ids.map((sid) =>
      window.termsprawl.agent.onSessionName(sid, (info) => {
        updateNodeData(id, { title: info.name })
      })
    )
    return () => offs.forEach((off) => off())
  }, [id, data.command, updateNodeData])

  // Inline title rename: double-click the title edits it; Enter/blur commits.
  // For claude agents the new name is pushed into the session via /rename so
  // the agent's own transcript session_name matches the node.
  const startTitleEdit = (): void => {
    setTitleDraft(data.title)
    setEditingTitle(true)
  }

  const commitTitleEdit = (): void => {
    setEditingTitle(false)
    const title = titleDraft.trim()
    if (!title || title === data.title) return
    updateNodeData(id, { title }, true)
    if (data.command?.startsWith('claude ')) {
      window.termsprawl.pty.write(id, `/rename ${title}\r`)
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: terminalSettings.fontFamily,
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#101010',
        foreground: '#e8e8e6',
        cursor: '#c6f135',
        selectionBackground: 'rgba(198, 241, 53, 0.25)'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    let active = true

    // Remote relay terminal (B3): mirrors a HOST terminal over the tunnel — no
    // local pty session is created. Output arrives as relay-term 'out' frames
    // (filtered to THIS host term id), keystrokes go back as 'in', resizes as
    // 'resized' (only once actually attached). Attach/detach is driven by the
    // relay-status effect below so it follows pairing (and re-attaches on a
    // reconnect); nothing is sent here.
    if (isRemote) {
      const termId = data.relayTerm as string
      const offFrame = window.termsprawl.relay.onFrame((frame) => {
        if (!active) return
        const parsed = parseRelayTermFrame(frame.text)
        if (!parsed || parsed.k !== 'out' || parsed.term !== termId) return
        term.write(parsed.data)
      })
      const disposeInput = term.onData((chunk) => {
        void window.termsprawl.relay.sendFrame(JSON.stringify({ v: 1, k: 'in', term: termId, data: chunk }))
      })
      const disposeResize = term.onResize(({ cols, rows }) => {
        // Skip pre-attach resizes (the attach effect sends the authoritative
        // initial size once the node is actually mirrored to the host pty).
        if (!attachedRef.current) return
        void window.termsprawl.relay.sendFrame(
          JSON.stringify({ v: 1, k: 'resized', term: termId, cols, rows } satisfies RelayTermFrame)
        )
      })
      termRef.current = term
      fitRef.current = fit
      return () => {
        active = false
        offFrame()
        disposeInput.dispose()
        disposeResize.dispose()
        termRef.current = null
        fitRef.current = null
        term.write('', () => {
          requestAnimationFrame(() => requestAnimationFrame(() => term.dispose()))
        })
      }
    }

    // Subscribe to output BEFORE creating the session so no early data is lost.
    const offData = window.termsprawl.pty.onData(id, (chunk) => {
      if (active) term.write(chunk)
    })
    const offExit = window.termsprawl.pty.onExit(id, () => {
      if (active) term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
    })

    // A remote project's terminal runs over ssh -tt + remote tmux.
    const ownerRemote = getOwningRemote(ownerProjectIdRef.current)
    void window.termsprawl.pty
      .create({
        id,
        projectId: ownerProjectIdRef.current ?? undefined,
        cols: term.cols,
        rows: term.rows,
        cwd: data.cwd,
        command: data.command,
        terminalProfile: terminalSettings.profile,
        ...(ownerRemote ? { remote: ownerRemote } : {})
      })
      .then(async (result) => {
        if (!active) return
        // Cold start (first open or post-reboot): the tmux session is gone, so
        // replay the persisted scrollback snapshot. Warm reattach skips it —
        // tmux already redraws.
        if (result.fresh) {
          const scrollback = await window.termsprawl.pty.readScrollback(id)
          if (active && scrollback) {
            term.write(`\x1b[2J\x1b[H${scrollback}`)
            term.write('\r\n\x1b[90m── session restored ──\x1b[0m\r\n')
          }
        }
      })
      .catch((err: unknown) => {
        if (active) term.write(`\r\n\x1b[91m[spawn failed: ${String(err)}]\x1b[0m\r\n`)
      })

    const disposeInput = term.onData((chunk) => window.termsprawl.pty.write(id, chunk))
    const disposeResize = term.onResize(({ cols, rows }) => {
      window.termsprawl.pty.resize(id, cols, rows)
    })

    termRef.current = term
    fitRef.current = fit

    return () => {
      active = false
      disposeInput.dispose()
      disposeResize.dispose()
      offData()
      offExit()
      termRef.current = null
      fitRef.current = null
      // xterm parses writes and refreshes its viewport asynchronously. Wait
      // until queued writes and two render frames have drained before disposal;
      // otherwise a pending viewport refresh can read already-disposed services.
      term.write('', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => term.dispose()))
      })
    }
  }, [id, data.cwd, data.command, isRemote, data.relayTerm])

  // Remote relay node (B3): follow the local relay connection so we can show a
  // clear "waiting for relay peer" state and (re)attach once actually paired.
  // Only meaningful for remote nodes; local terminals ignore relay status.
  useEffect(() => {
    if (!isRemote) return
    let alive = true
    const sync = (status: { state: string; error: string | null }): void => {
      if (!alive) return
      setRelayStatus(status.state)
    }
    void window.termsprawl.relay.status().then(sync).catch(() => {})
    const off = window.termsprawl.relay.onStatus(sync)
    return () => {
      alive = false
      off()
    }
  }, [isRemote])

  // Attach/detach lifecycle: attach the node to the host terminal once we are
  // paired, send our initial terminal size, and detach on unmount or when the
  // link drops. Re-runs whenever pairing changes → a reconnect re-attaches.
  useEffect(() => {
    if (!isRemote || relayStatus !== 'paired') return
    const termId = data.relayTerm as string
    const send = (frame: RelayTermFrame): void => {
      void window.termsprawl.relay.sendFrame(JSON.stringify(frame))
    }
    attachedRef.current = true
    send({ v: 1, k: 'attach', term: termId })
    const term = termRef.current
    if (term) {
      send({ v: 1, k: 'resized', term: termId, cols: term.cols, rows: term.rows })
    }
    return () => {
      attachedRef.current = false
      send({ v: 1, k: 'detach', term: termId })
    }
  }, [isRemote, relayStatus, data.relayTerm])

  // Keep the terminal fitted to its container and push the new size to the
  // pty — deferred out of the ResizeObserver callback (rAF) so xterm's own
  // element writes never re-trigger the observer in the same frame (that's
  // the "ResizeObserver loop completed with undelivered notifications" noise).
  // A remote relay node sizes via its xterm onResize → 'resized' frame over
  // the tunnel (see the mount effect); it must never touch a local pty.
  useSafeResize(hostRef, () => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    fit.fit()
    if (isRemote) return
    window.termsprawl.pty.resize(id, term.cols, term.rows)
  })

  return (
    <div className="terminal-node">
      <NodeResizer isVisible={selected} minWidth={240} minHeight={140} />
      <LinkHandles />
      <div className="terminal-node-header">
        <span className="terminal-node-dot" />
        {editingTitle ? (
          <input
            className="nodrag nowheel terminal-title-input"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitleEdit()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="terminal-node-title"
            title={data.command ? 'Double-click to rename' : undefined}
            onDoubleClick={(e) => {
              e.stopPropagation()
              startTitleEdit()
            }}
          >
            {data.title}
          </span>
        )}
        {isRemote && <span className="terminal-remote-badge">remote</span>}
        <HelpBadge
          label="about this terminal"
          text={terminalHelp(data.command, isRemote)}
        />
        {agentHint && agentStatus && (
          <span className={`agent-badge agent-${agentStatus}`}>{STATUS_LABEL[agentStatus]}</span>
        )}
        {hasUnread && (
          <button
            className="unread-dot"
            title="Agent needs attention — click to focus"
            aria-label="Agent needs attention"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              clearUnread(id)
            }}
          />
        )}
        <button
          className="node-close"
          title={isRemote ? 'Close terminal (detach from host)' : 'Close terminal (kills session)'}
          aria-label="Close terminal"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
      </div>
      {isRemote && relayStatus !== 'paired' && (
        <div className="terminal-remote-status">
          remote — {relayStatus === 'connecting' ? 'connecting to relay peer' : relayStatus === 'error' ? 'relay error' : 'waiting for relay peer'}
        </div>
      )}
      <div
        className="terminal-node-host nodrag nowheel"
        ref={hostRef}
        onContextMenu={(e) => {
          // Right-click inside the terminal belongs to tmux (its mouse menu,
          // copy/paste). Swallow the contextmenu event so React Flow's canvas
          // menu never opens over the terminal, and the browser's native menu
          // stays suppressed too.
          e.preventDefault()
          e.stopPropagation()
        }}
      />
    </div>
  )
}

function terminalHelp(command: string | undefined, isRemote: boolean): string {
  if (isRemote) {
    return 'A remote terminal streamed from a paired relay host over the E2E-encrypted tunnel. Output renders here; keystrokes go back to the host. Drag the header to move the node. Close detaches this view from the host terminal; the host terminal keeps running.'
  }
  if (!command) {
    return 'A real PTY inside a tmux session that survives remounts and app restarts. Drag the header to move the node. Hover, then dwell, to type. Wheel scrolls tmux history. Close kills this session; switching project tabs only detaches.'
  }
  if (command.startsWith('druk')) {
    return 'Opens the druk TUI editor in this project folder, still inside tmux. Same hover-guard as a shell: drag the header, dwell to type. Close kills the druk session.'
  }
  return 'An agent CLI launched once in a persistent tmux session. Status badges come from local hooks. Double-click the title to rename — Claude also gets /rename. Right-click for branch / resume when the CLI supports it. Close kills the session.'
}
