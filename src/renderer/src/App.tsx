import { useEffect, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Canvas } from './canvas/Canvas'

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
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  )
}
