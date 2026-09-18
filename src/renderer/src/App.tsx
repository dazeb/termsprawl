import { SetupHost } from './components/DependencySetup'
import { useEffect, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Canvas } from './canvas/Canvas'
import { TabBar } from './components/TabBar'
import { UpdateToast } from './components/UpdateToast'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { AppSettingsPanel } from './components/AppSettingsPanel'
import { CogMenu } from './components/CogMenu'
import { OrganizeButton } from './components/OrganizeButton'
import { HelpBadge } from './components/HelpBadge'
import { isResizeObserverNoise } from './ro-noise'
import { useProjects } from './state/projects'
import { resolveAccent } from './state/accent'
import { applyTheme, resolveTheme } from './state/theme'
import { useBrowserHome } from './state/browser-home'
import { Onboarding, ShouldShowOnboarding } from './components/Onboarding'
import { TesseractSpinner } from './components/TesseractSpinner'
import { useBootOverlay } from './hooks/useBootOverlay'
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
  const activeRemote = projects.find((p) => p.id === activeProjectId)?.remote
  const activeAccent = projects.find((p) => p.id === activeProjectId)?.settings?.accent

  // Resolved once: the shell's CSS var override and the boot tesseract must
  // agree on the accent, and resolveAccent is also the never-purple guard.
  const accent = resolveAccent(activeAccent)
  const theme = resolveTheme(settings?.theme ?? 'system')
  const boot = useBootOverlay(loaded)

  useEffect(() => {
    void window.termsprawl?.appVersion().then(setVersion)
    void window.termsprawl?.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme ?? 'system')
    })
    void load()
  }, [load])

  // Keep the browser home URL available to canvas nodes (they can't take props).
  useEffect(() => {
    useBrowserHome.getState().setHomeUrl(settings?.browserHomeUrl)
  }, [settings])

  // Source control lives in the sidebar; the cog button opens settings only.

  // Visible error surface: any uncaught renderer error shows as a banner so
  // failures are never silent (used for diagnosing machine-specific issues).
  // The benign ResizeObserver loop report (see ro-noise.ts) is filtered HERE —
  // preventDefault in main.tsx stops the DevTools console report but does NOT
  // stop other 'error' listeners, so this handler must ignore it too or the
  // banner re-appears on every node resize.
  useEffect(() => {
    const onError = (e: ErrorEvent): void => {
      if (isResizeObserverNoise(e.message)) return
      setError(e.message || String(e.error ?? 'unknown error'))
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      const reason = e.reason
      const message = reason instanceof Error ? reason.message : String(reason ?? 'unhandled promise rejection')
      if (isResizeObserverNoise(message)) return
      setError(message)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return (
    <div
      className="shell"
      // resolveAccent is the never-purple guard: a legacy/imported purple (or
      // any non-hex junk) resolves to undefined and the default lime applies.
      style={accent ? ({ ['--accent']: accent } as React.CSSProperties) : undefined}
    >
      <div className="toolbar">
        <span className="brand">
          termsprawl
          <span className="brand-pill">pre-1.0</span>
          <HelpBadge
            label="what is termsprawl"
            text="A Linux canvas of terminals, editors, and agents — not a tab bar. Each project is a folder. Drag nodes, pan the empty canvas, scroll to zoom. Sessions live in tmux, so closing a tab detaches instead of killing shells. Hover a canvas edge for the project file tree."
          />
        </span>
        <TabBar />
        <OrganizeButton disabled={!activeProjectId} />
        <CogMenu onOpenSettings={() => setSettingsOpen(true)} />
        <span className="version">v{version}</span>
      </div>
      {settingsOpen && (
        <AppSettingsPanel onClose={() => setSettingsOpen(false)} onSettingsChange={setSettings} />
      )}
      {/* First-run onboarding: only when the guide was never finished AND the
          workspace has no projects yet. Dismissal persists onboardedAt. */}
      {settings && ShouldShowOnboarding(settings, projects.filter((p) => !p.closed && !p.archived).length) && (
        <Onboarding
          onDismiss={() => {
            void window.termsprawl.settings.set({ onboardedAt: new Date().toISOString() }).then(setSettings)
          }}
        />
      )}
      <SetupHost />
      <UpdateToast />
      <AnnouncementBanner />
      {error && (
        <div className="error-banner" onClick={() => setError(null)} title="Click to dismiss">
          ⚠ {error}
        </div>
      )}
      {/* The stage is the positioning context shared by the canvas and the boot
          overlay. The overlay must span the canvas area only — the toolbar
          above stays visible (as it did when the overlay lived inside the
          canvas div). */}
      <div className="canvas-stage">
        {loaded ? (
          <ReactFlowProvider>
            <Canvas cwd={activeCwd} remote={activeRemote} invertWheelZoom={settings?.invertWheelZoom ?? false} />
          </ReactFlowProvider>
        ) : (
          <div className="canvas" />
        )}
        {/* Boot overlay: the tesseract spins over the dot grid while the
            workspace store loads over IPC. It is a SIBLING of the canvas rather
            than an alternative to it, so the canvas mounts at the moment
            loading finishes and the overlay cross-fades away on top — the fade
            adds no startup time. */}
        {boot.visible && (
          <div className={`boot-overlay${boot.leaving ? ' boot-overlay--leaving' : ''}`}>
            <TesseractSpinner accent={accent} theme={theme} />
          </div>
        )}
      </div>
    </div>
  )
}
