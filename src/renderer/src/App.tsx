import { useEffect, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Canvas } from './canvas/Canvas'
import { TabBar } from './components/TabBar'
import { UpdateToast } from './components/UpdateToast'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { AppSettingsPanel } from './components/AppSettingsPanel'
import { CogMenu } from './components/CogMenu'
import { HelpBadge } from './components/HelpBadge'
import { useProjects } from './state/projects'
import { applyTheme } from './state/theme'
import { useSidebarRequests } from './state/sidebar-requests'
import type { AppSettings } from '@shared/types'

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('…')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loaded = useProjects((s) => s.loaded)
  const load = useProjects((s) => s.load)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const projects = useProjects((s) => s.projects)
  const activeCwd = projects.find((p) => p.id === activeProjectId)?.cwd ?? undefined
  const activeAccent = projects.find((p) => p.id === activeProjectId)?.settings?.accent

  useEffect(() => {
    void window.termsprawl?.appVersion().then(setVersion)
    void window.termsprawl?.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme ?? 'system')
    })
    void load()
  }, [load])

  // Source control now lives in the sidebar (VS Code-style); the cog menu just
  // opens that section. The sidebar consumes the request itself.
  const openSourceControl = (): void => {
    useSidebarRequests.getState().openSection('source')
  }

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
    <div className="shell" style={activeAccent ? ({ ['--accent']: activeAccent } as React.CSSProperties) : undefined}>
      <div className="toolbar">
        <span className="brand">
          termsprawl
          <span className="brand-pill">alpha</span>
          <HelpBadge
            label="what is termsprawl"
            text="A Linux canvas of terminals, editors, and agents — not a tab bar. Each project is a folder. Drag nodes, pan the empty canvas, scroll to zoom. Sessions live in tmux, so closing a tab detaches instead of killing shells. Hover a canvas edge for the project file tree."
          />
        </span>
        <TabBar />
        <CogMenu
          hasActiveProject={!!activeCwd}
          onOpenSourceControl={openSourceControl}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <span className="version">v{version}</span>
      </div>
      {settingsOpen && (
        <AppSettingsPanel onClose={() => setSettingsOpen(false)} onSettingsChange={setSettings} />
      )}
      <UpdateToast />
      <AnnouncementBanner />
      {error && (
        <div className="error-banner" onClick={() => setError(null)} title="Click to dismiss">
          ⚠ {error}
        </div>
      )}
      {loaded ? (
        <ReactFlowProvider>
          <Canvas cwd={activeCwd} invertWheelZoom={settings?.invertWheelZoom ?? false} />
        </ReactFlowProvider>
      ) : (
        <div className="canvas" />
      )}
    </div>
  )
}
