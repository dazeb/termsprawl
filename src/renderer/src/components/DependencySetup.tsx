import React, { useEffect, useRef, useState } from 'react'
import type { InstallableAgent, SetupJob } from '@shared/dependencies'
import { useSetup, setupNoticeNeeded, updateAvailable } from '../state/setup'
import { useProjects } from '../state/projects'
import { useCanvasRequests } from '../state/canvas-requests'
import { Button } from './ui/kit'

export function DependencySetup({ onOpen }: { onOpen?: () => void }): React.JSX.Element {
  const { snapshot, error, refresh, requested } = useSetup()
  const [job, setJob] = useState<SetupJob | null>(snapshot?.job ?? null)
  const previousJob = useRef(job)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => {
    void refresh()
    let alive = true; let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      try {
        const next = await window.termsprawl.dependencies?.status()
        if (!alive) return
        if (previousJob.current?.state === 'installing' && next?.state !== 'installing') void refresh()
        previousJob.current = next ?? null
        setJob(next ?? null)
      } catch (error) { if (alive) setLocalError(String(error)) }
      if (alive) timer = setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [refresh])
  const run = async (action: () => Promise<void>): Promise<void> => {
    setPending(true); setLocalError(null)
    try { await action() } catch (error) { setLocalError(String(error)) } finally { setPending(false) }
  }
  const openTerminal = async (agent?: InstallableAgent, command?: string): Promise<void> => {
    const state = useProjects.getState()
    const active = state.projects.find(p => p.id === state.activeProjectId)
    if (!active || active.remote) await state.create('Local setup', null)
    useCanvasRequests.getState().spawn(agent ? { kind: 'agent', agent } : { kind: 'agentLogin', command: command!, title: 'Install system tools' })
    useSetup.getState().close(); onOpen?.()
  }
  if (!window.termsprawl.dependencies) return <p>Agent installation is available in the Linux desktop app.</p>
  const busy = pending || job?.state === 'installing'
  return <div className="dependency-setup">
    <p>Choose the agents you want. Installation does not sign you in; open the agent afterward to configure a provider. Existing installations are kept.</p>
    <div className="setup-actions">
      <Button disabled={pending} onClick={() => void run(refresh)}>Check your setup</Button>
      <Button disabled={busy} onClick={() => void run(async () => { useSetup.setState({ snapshot: await window.termsprawl.dependencies!.checkUpdates() }) })}>Check for updates</Button>
    </div>
    {(error || localError) && <p role="alert">{localError ?? error}</p>}
    {!snapshot && !error && <p role="status">Checking installed tools…</p>}
    {snapshot?.dependencies.map(d => {
      const agent = !['tmux', 'git', 'curl', 'tar', 'unzip', 'bash'].includes(d.id)
      const failed = job?.agent === d.id && job.state === 'failed'
      return <div className={`setup-item${requested === d.id ? ' setup-item-requested' : ''}`} key={d.id}>
        <div><strong>{d.name}</strong> <span>{job?.agent === d.id && job.state === 'installing' ? 'installing' : d.state}{d.version ? ` · ${d.version}` : ''}{d.managed ? ' · installed through setup' : ''}</span></div>
        {d.path && <code>{d.path}</code>}
        {d.detail && <p>{d.detail}</p>}
        {d.id === 'tmux' && d.state !== 'installed' && <p>Terminal sessions will not have reliable continuity across app restarts until tmux ≥3.2 is available.</p>}
        {d.id === 'git' && d.state !== 'installed' && <p>Repository cloning and source-control actions need Git.</p>}
        {agent && <div className="setup-actions">
          {(d.state === 'missing' || d.managed && (failed || d.state === 'incompatible' || updateAvailable(d.version, d.latest))) &&
            <Button disabled={busy} onClick={() => void run(async () => { setJob(await window.termsprawl.dependencies!.install(d.id as InstallableAgent)) })}>
              {failed ? 'Retry' : d.state === 'installed' ? `Update to ${d.latest}` : 'Install'}
            </Button>}
          {d.state === 'installed' && <Button disabled={busy} onClick={() => void run(() => openTerminal(d.id as InstallableAgent))}>Open</Button>}
          {d.state !== 'missing' && !d.managed && <small>External installation — use its vendor or package manager to update or repair it.</small>}
        </div>}
        {d.latest && <small>Latest stable: {d.latest}</small>}
        {d.updateError && <small>Update check unavailable: {d.updateError}. Your installed tool is unchanged.</small>}
        {agent && d.instructions && <small>{d.instructions}</small>}
      </div>
    })}
    {snapshot?.dependencies.some(d => ['tmux', 'git', 'curl', 'tar', 'unzip', 'bash'].includes(d.id) && d.state !== 'installed') && <div className="setup-item">
      <strong>Install system tools</strong>
      {snapshot.systemCommand ? <><p>Run the following in a visible local terminal. Your package manager may ask for your password.</p><code>{snapshot.systemCommand}</code>
        <Button onClick={() => void run(() => openTerminal(undefined, snapshot.systemCommand!))}>Open installation terminal</Button></>
        : <p>Use your distribution’s package manager to install the missing tools listed above, then check your setup again.</p>}
    </div>}
    {snapshot?.restartRequired && <p role="status">tmux is now available. Restart Termsprawl to enable continuity for new terminals. Existing terminals have not been replaced.</p>}
    {job && <div className="setup-item" aria-live="polite"><strong>{job.phase}</strong>{job.error && <p role="alert">{job.error}</p>}
      <details><summary>Installation log</summary><pre>{job.logs || 'Starting…'}</pre></details>
    </div>}
  </div>
}
export function SetupHost(): React.JSX.Element | null {
  const { open, close, show, snapshot, refresh } = useSetup()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('termsprawl-setup-dismissed') === '1')
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [open, close])
  if (!window.termsprawl.dependencies) return null
  return <>
    {!dismissed && setupNoticeNeeded(snapshot) && !open && <div className="setup-notice"><span>Some system tools need setup.</span>
      <Button onClick={() => show()}>Check your setup</Button><Button onClick={() => { setDismissed(true); localStorage.setItem('termsprawl-setup-dismissed', '1') }}>Dismiss</Button></div>}
    {open && <div className="modal-backdrop"><section className="setup-dialog" role="dialog" aria-modal="true" aria-label="Check your setup">
      <div className="setup-heading"><h2>Check your setup</h2><Button onClick={close}>Close</Button></div><DependencySetup />
      <Button onClick={close}>Skip — continue to canvas</Button>
    </section></div>}
  </>
}
