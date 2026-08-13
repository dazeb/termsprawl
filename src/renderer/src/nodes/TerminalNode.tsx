import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalNodeProps {
  id: string
  title?: string
  cwd?: string
}

// One terminal session, rendered with xterm.
// The PTY is created once per node id; the component must never remount the
// same id (React Flow keys nodes by id — keep ids stable).
export function TerminalNode({ id, title, cwd }: TerminalNodeProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

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
    const offData = window.termsprawl.pty.onData(id, (data) => term.write(data))
    const offExit = window.termsprawl.pty.onExit(id, () => {
      term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
    })

    void window.termsprawl.pty
      .create({ id, cols: term.cols, rows: term.rows, cwd })
      .catch((err: unknown) => {
        term.write(`\r\n\x1b[91m[spawn failed: ${String(err)}]\x1b[0m\r\n`)
      })

    const writeInput = (data: string): void => window.termsprawl.pty.write(id, data)
    const disposeInput = term.onData(writeInput)
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
  }, [id, cwd])

  return (
    <div className="terminal-node">
      <div className="terminal-node-header">
        <span className="terminal-node-dot" />
        <span className="terminal-node-title">{title ?? id}</span>
      </div>
      <div className="terminal-node-host" ref={hostRef} />
    </div>
  )
}
