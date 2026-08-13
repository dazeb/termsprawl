import { useEffect, useState } from 'react'
import { TerminalNode } from './nodes/TerminalNode'

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('…')

  useEffect(() => {
    void window.termsprawl?.appVersion().then(setVersion)
  }, [])

  return (
    <div className="shell">
      <div className="toolbar">
        <span className="brand">termsprawl</span>
        <span className="version">v{version}</span>
      </div>
      <div className="canvas">
        <TerminalNode id="demo-1" title="demo shell" cwd={process.cwd()} />
      </div>
    </div>
  )
}
