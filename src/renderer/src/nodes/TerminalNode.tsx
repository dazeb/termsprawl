import { useEffect, useRef, useState } from 'react'
import type { Node, NodeProps } from 'reactflow'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeData } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import { useAgentStatuses } from '../state/agents'

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
// happens via the header (the drag handle). The × button closes the node and
// destroys its tmux session (unmount cleanup calls pty.destroy).
export function TerminalNode({ id, data }: NodeProps<TerminalNodeData>): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const { closeNode } = useCanvas()
  const agentStatus = useAgentStatuses((s) => s.byId[id])
  const setAgentStatus = useAgentStatuses((s) => s.set)
  const clearAgentStatus = useAgentStatuses((s) => s.clear)
  const hasUnread = useAgentStatuses((s) => s.unread[id] === true)
  const clearUnread = useAgentStatuses((s) => s.clearUnread)
  const [agentHint, setAgentHint] = useState(false)

  // Agent nodes (spawned with a command) subscribe to hook status. Only claude
  // pins session-id = node id today; others never receive events (fail-open).
  useEffect(() => {
    if (!data.command) return
    setAgentHint(true)
    const off = window.termsprawl.agent.onStatus(id, (event) => {
      setAgentStatus(id, event.status)
    })
    return () => {
      off()
      clearAgentStatus(id)
    }
  }, [id, data.command, setAgentStatus, clearAgentStatus])

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

    // Subscribe to output BEFORE creating the session so no early data is lost.
    const offData = window.termsprawl.pty.onData(id, (chunk) => term.write(chunk))
    const offExit = window.termsprawl.pty.onExit(id, () => {
      term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
    })

    void window.termsprawl.pty
      .create({ id, cols: term.cols, rows: term.rows, cwd: data.cwd, command: data.command })
      .then(async (result) => {
        // Cold start (first open or post-reboot): the tmux session is gone, so
        // replay the persisted scrollback snapshot. Warm reattach skips it —
        // tmux already redraws.
        if (result.fresh) {
          const scrollback = await window.termsprawl.pty.readScrollback(id)
          if (scrollback) {
            term.write(`\x1b[2J\x1b[H${scrollback}`)
            term.write('\r\n\x1b[90m── session restored ──\x1b[0m\r\n')
          }
        }
      })
      .catch((err: unknown) => {
        term.write(`\r\n\x1b[91m[spawn failed: ${String(err)}]\x1b[0m\r\n`)
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
      observer.disconnect()
      disposeInput.dispose()
      disposeResize.dispose()
      offData()
      offExit()
      window.termsprawl.pty.destroy(id)
      term.dispose()
    }
  }, [id, data.cwd])

  return (
    <div className="terminal-node">
      <div className="terminal-node-header">
        <span className="terminal-node-dot" />
        <span className="terminal-node-title">{data.title}</span>
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
      <div className="terminal-node-host nodrag nowheel" ref={hostRef} />
    </div>
  )
}
