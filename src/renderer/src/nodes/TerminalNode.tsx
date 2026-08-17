import { useEffect, useRef, useState } from 'react'
import type { Node, NodeProps } from 'reactflow'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeData } from '../state/workspace'
import { resumedSessionId } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import { useAgentStatuses } from '../state/agents'
import { useProjects } from '../state/projects'

// Status badge labels for agent nodes (Phase 7). Only nodes spawned with a
// command (agent presets like claude/codex, druk) can carry a status.
const STATUS_LABEL: Record<string, string> = {
  working: 'RUNNING',
  waiting: 'NEEDS YOU',
  blocked: 'BLOCKED',
  done: 'DONE'
}

// One terminal session, rendered with xterm, as a React Flow custom node.
// The PTY session id IS the React Flow node id — keep ids stable or the
// session respawns. The body is nodrag so xterm owns mouse input; dragging
// happens via the header (the drag handle). The × button asks Canvas to
// destroy the tmux session; ordinary React unmount only detaches the view.
export function TerminalNode({ id, data }: NodeProps<TerminalNodeData>): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
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
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.title)

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
      fontFamily: 'Geist Mono, JetBrains Mono, monospace',
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

    // Subscribe to output BEFORE creating the session so no early data is lost.
    const offData = window.termsprawl.pty.onData(id, (chunk) => {
      if (active) term.write(chunk)
    })
    const offExit = window.termsprawl.pty.onExit(id, () => {
      if (active) term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
    })

    void window.termsprawl.pty
      .create({
        id,
        projectId: ownerProjectIdRef.current ?? undefined,
        cols: term.cols,
        rows: term.rows,
        cwd: data.cwd,
        command: data.command
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

    // Keep the terminal fitted to its container; push the new size to the pty.
    const observer = new ResizeObserver(() => {
      fit.fit()
      window.termsprawl.pty.resize(id, term.cols, term.rows)
    })
    observer.observe(host)

    return () => {
      active = false
      observer.disconnect()
      disposeInput.dispose()
      disposeResize.dispose()
      offData()
      offExit()
      // xterm parses writes and refreshes its viewport asynchronously. Wait
      // until queued writes and two render frames have drained before disposal;
      // otherwise a pending viewport refresh can read already-disposed services.
      term.write('', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => term.dispose()))
      })
    }
  }, [id, data.cwd, data.command])

  return (
    <div className="terminal-node">
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
          title="Close terminal (kills session)"
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
