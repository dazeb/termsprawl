import { useEffect, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Canvas } from './canvas/Canvas'
import { TabBar } from './components/TabBar'
import { useProjects } from './state/projects'

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('…')
  const loaded = useProjects((s) => s.loaded)
  const load = useProjects((s) => s.load)

  useEffect(() => {
    void window.termsprawl?.appVersion().then(setVersion)
    void load()
  }, [load])

  return (
    <div className="shell">
      <div className="toolbar">
        <span className="brand">termsprawl</span>
        <TabBar />
        <span className="version">v{version}</span>
      </div>
      {loaded ? (
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      ) : (
        <div className="canvas" />
      )}
    </div>
  )
}
