import { useEffect, useState } from 'react'

declare global {
  interface Window {
    termsprawl?: {
      appVersion: () => Promise<string>
    }
  }
}

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('…')

  useEffect(() => {
    void window.termsprawl?.appVersion().then(setVersion)
  }, [])

  return (
    <div className="shell">
      <div className="brand">termsprawl</div>
      <div className="hint">
        An infinite canvas for your terminals. Phase 1 scaffold — canvas and
        sessions land next.
      </div>
      <div className="version">v{version}</div>
    </div>
  )
}
