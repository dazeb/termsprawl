// First-run onboarding (Task 3.2): a single dismissible overlay shown when
// the workspace has no projects yet and the user has never finished the
// guide (settings.onboardedAt absent). Three steps to a running terminal.
// Honesty rule: every step describes SHIPPED behavior only. Dismissal writes
// the onboardedAt marker — never shown again (Settings can re-run it).
// NOTE: `import React` is required for vitest (no jsx:react-jsx transform in
// the test build); the app build ignores it via the JSX runtime.
import React from 'react'
import { useEffect } from 'react'
import { useProjects } from '../state/projects'
import { projectNameFromPath } from '../state/workspace'
import { Button } from './ui/kit'

export interface OnboardingProps {
  onDismiss(): void
}

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Create a project',
    body: 'Open a folder (or name a scratch project) with the + tab. A project is a folder — termsprawl opens shells in it.'
  },
  {
    title: 'Spawn a terminal',
    body: 'Right-click the canvas and choose New terminal. It is a real shell inside tmux: closing the app detaches it, it does not die.'
  },
  {
    title: 'Arrange it your way',
    body: 'Drag nodes by the header, pan the empty canvas, scroll to zoom. The organize button (top right) tidies everything: cascade → flat → restore.'
  }
]

export function ShouldShowOnboarding(settings: { onboardedAt?: string }, projectCount: number): boolean {
  return !settings.onboardedAt && projectCount === 0
}

export function Onboarding({ onDismiss }: OnboardingProps): React.JSX.Element {
  // Escape dismisses, same convention as the settings sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const createProject = (): void => {
    // Dismiss FIRST so the folder dialog opens over a clean canvas, then run
    // the same flow the + tab uses (folder picker → named project).
    onDismiss()
    void window.termsprawl.workspace.selectFolder().then((cwd) => {
      if (!cwd) return
      const store = useProjects.getState()
      void store.create(projectNameFromPath(cwd, 'project-1'), cwd)
    })
  }

  return (
    <div className="onboarding-scrim" role="dialog" aria-label="Getting started with termsprawl">
      <div className="onboarding-card">
        <h2 className="onboarding-title">
          Welcome to termsprawl<span className="brand-pill">alpha</span>
        </h2>
        <p className="onboarding-sub">Terminals, editors, and AI agents — on one canvas, not in a tab bar.</p>
        <ol className="onboarding-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="onboarding-step">
              <span className="onboarding-step-num">{i + 1}</span>
              <span>
                <strong>{s.title}</strong>
                <span className="onboarding-step-body">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="onboarding-actions">
          <Button variant="primary" onClick={createProject}>
            Get started — create a project
          </Button>
          <Button onClick={onDismiss}>
            Skip — I know my way around
          </Button>
        </div>
      </div>
    </div>
  )
}
