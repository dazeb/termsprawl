import { useEffect, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Canvas } from './canvas/Canvas'
import { TabBar } from './components/TabBar'
import { useProjects } from './state/projects'

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('…')
  const [error, setError] = useState<string | null>(null)
  const loaded = useProjects((s) => s.loaded)
  const load = useProjects((s) => s.load)

  useEffect(() => {
    void window.termsprawl?.appVersion().then(setVersion)
    void load()
  }, [load])

  // Visible error surface: any uncaught renderer error shows as a banner so
  // failures are never silent (used for diagnosing machine-specific issues).
  useEffect(() => {
    const onError = (e: ErrorEvent): void => {
      setError(e.message || String(e.error ?? 'unknown error'))
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      setError(String(e.reason ?? 'unhandled promise rejection'))
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return (
    <div className="shell">
      <div className="toolbar">
        <span className="brand">termsprawl</span>
        <TabBar />
        <span className="version">v{version}</span>
      </div>
      {error && (
        <div className="error-banner" onClick={() => setError(null)} title="Click to dismiss">
          ⚠ {error}
        </div>
      )}
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
