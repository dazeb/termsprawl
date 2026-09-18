import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AGENT_REGISTRY } from '../shared/agents/config'
import type { DependencyId, DependencyStatus, InstallableAgent, SetupJob, SetupSnapshot } from '../shared/dependencies'
import { commandCandidates, findExecutable, setManagedBin } from './command-resolver'
import { clearAgentProbeCache } from './agent-tool-launch'
import { activateStaged, INSTALL_SOURCES, installRelease, latestRelease, linuxArch, runProcess, type Release } from './dependency-installers'

export const SETUP_AGENTS = Object.keys(INSTALL_SOURCES) as InstallableAgent[]
const SYSTEM_TOOLS = ['tmux', 'git', 'curl', 'tar', 'unzip', 'bash'] as const
interface Installation { path: string; version: string; source: string; installedAt: string }
interface Manifest { installations: Partial<Record<InstallableAgent, Installation>>; job: SetupJob | null }
export interface DependencyOptions {
  home?: string
  active?: (id: InstallableAgent) => boolean
  resolveRelease?: typeof latestRelease
  installer?: typeof installRelease
  probe?: (path: string, env: NodeJS.ProcessEnv) => Promise<string>
}
export function numericVersion(text: string): string | undefined { return /\b(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] }
export function newerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number), b = (numericVersion(current) ?? '0').split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) }
  return false
}
export function systemInstallCommand(osRelease: string, ids: readonly string[]): string | null {
  const packages = ids.filter(id => (SYSTEM_TOOLS as readonly string[]).includes(id))
  if (!packages.length) return null
  const values = osRelease.split('\n').filter(l => /^(ID|ID_LIKE)=/.test(l)).map(l => l.split('=').slice(1).join('=').replace(/["']/g, '')).join(' ').split(/\s+/)
  const names = packages.join(' ')
  if (values.some(v => ['debian', 'ubuntu'].includes(v))) return `sudo apt-get update && sudo apt-get install -- ${names}`
  if (values.some(v => ['fedora', 'rhel', 'centos'].includes(v))) return `sudo dnf install -- ${names}`
  if (values.includes('arch')) return `sudo pacman -S --needed -- ${names}`
  if (values.some(v => ['suse', 'opensuse', 'opensuse-tumbleweed', 'opensuse-leap'].includes(v))) return `sudo zypper install -- ${names}`
  return null
}
export class DependencyService {
  readonly tools: string
  private home: string
  private manifest: Manifest
  private cached: { at: number; snapshot: SetupSnapshot } | null = null
  private checks: Promise<SetupSnapshot> | null = null
  private updates = new Map<InstallableAgent, { latest?: string; updateError?: string }>()
  private wasMissingTmux: boolean
  private persistence: Promise<void> = Promise.resolve()
  constructor(private userData: string, private options: DependencyOptions = {}) {
    this.home = options.home ?? homedir()
    this.tools = join(userData, 'tools')
    setManagedBin(join(this.tools, 'bin'))
    this.wasMissingTmux = !findExecutable('tmux', this.home)
    try {
      const saved = JSON.parse(readFileSync(join(userData, 'dependencies.json'), 'utf8')) as Manifest
      this.manifest = { installations: saved.installations ?? {}, job: saved.job ?? null }
      if (this.manifest.job?.state === 'installing') this.manifest.job = { ...this.manifest.job, state: 'failed', phase: 'Interrupted', error: 'The app closed during installation. Check your setup and retry.' }
    } catch { this.manifest = { installations: {}, job: null } }
  }
  get job(): SetupJob | null { return this.manifest.job ? { ...this.manifest.job } : null }
  get busy(): boolean { return this.manifest.job?.state === 'installing' }
  private save(): Promise<void> {
    const data = JSON.stringify(this.manifest, null, 2)
    this.persistence = this.persistence.catch(() => {}).then(async () => {
      await mkdir(this.userData, { recursive: true })
      const path = join(this.userData, 'dependencies.json')
      await writeFile(`${path}.tmp`, data, { mode: 0o600 }); await rename(`${path}.tmp`, path)
    })
    return this.persistence
  }
  private async probe(path: string): Promise<string> {
    const env = { ...process.env, HOME: this.home }
    if (this.options.probe) return this.options.probe(path, env)
    const flag = path.endsWith('/tmux') ? '-V' : path.endsWith('/unzip') ? '-v' : '--version'
    return runProcess(path, [flag], env, () => {}, path.endsWith('/opencode') ? 30_000 : 10_000)
  }
  private async inspect(id: DependencyId): Promise<DependencyStatus> {
    const agent = SETUP_AGENTS.includes(id as InstallableAgent) ? id as InstallableAgent : undefined
    const command = agent ? AGENT_REGISTRY[agent].command : id
    const path = findExecutable(command, this.home)
    const record = agent ? this.manifest.installations[agent] : undefined
    const status: DependencyStatus = { id, name: agent ? AGENT_REGISTRY[agent].name : id, state: 'missing', managed: false,
      ...(agent ? { instructions: `Official installation and updates: ${INSTALL_SOURCES[agent]}`, ...this.updates.get(agent) } : {}) }
    if (!path) {
      const broken = commandCandidates(command, this.home).find(p => existsSync(p))
      return broken ? { ...status, state: 'incompatible', path: broken, detail: 'Found a file that is not executable. Repair it before installation.' } : status
    }
    status.path = path; status.managed = record?.path === path
    try {
      const output = await this.probe(path)
      status.version = numericVersion(output)
      if (!status.version) throw new Error('The version probe did not return a recognizable version')
      status.state = 'installed'
      if (id === 'tmux' && newerVersion('3.2', status.version)) { status.state = 'incompatible'; status.detail = 'tmux 3.2 or newer is needed for terminal continuity.' }
    } catch (error) { status.state = 'incompatible'; status.detail = error instanceof Error ? error.message : String(error) }
    return status
  }
  check(refresh = false): Promise<SetupSnapshot> {
    if (!refresh && this.cached && Date.now() - this.cached.at < 60_000) return Promise.resolve({ ...this.cached.snapshot, job: this.job })
    if (this.checks) return this.checks
    this.checks = this.collect().then(snapshot => { this.cached = { at: Date.now(), snapshot }; return snapshot }).finally(() => { this.checks = null })
    return this.checks
  }
  private async collect(): Promise<SetupSnapshot> {
    const dependencies = await Promise.all([...SETUP_AGENTS, ...SYSTEM_TOOLS].map(id => this.inspect(id)))
    let os = ''; try { os = await readFile('/etc/os-release', 'utf8') } catch { /* instructions only */ }
    return { dependencies, job: this.job, systemCommand: systemInstallCommand(os, dependencies.filter(d => SYSTEM_TOOLS.includes(d.id as typeof SYSTEM_TOOLS[number]) && d.state !== 'installed').map(d => d.id)),
      restartRequired: this.wasMissingTmux && dependencies.some(d => d.id === 'tmux' && d.state === 'installed') }
  }
  async checkUpdates(): Promise<SetupSnapshot> {
    await Promise.all(SETUP_AGENTS.map(async id => {
      try { const release = await (this.options.resolveRelease ?? latestRelease)(id); this.updates.set(id, { latest: release.version }) }
      catch (error) { this.updates.set(id, { updateError: error instanceof Error ? error.message : String(error) }) }
    }))
    return this.check(true)
  }
  async install(id: InstallableAgent): Promise<SetupJob> {
    if (!SETUP_AGENTS.includes(id)) throw new Error('Unknown installer')
    if (process.platform !== 'linux') throw new Error('Setup is supported on Linux desktop only')
    linuxArch(process.arch)
    if (this.busy) throw new Error('An installation is already running')
    if (process.getuid?.() === 0) throw new Error('Run setup as your regular user, not root')
    // Acquire the lock before any asynchronous probe.
    this.manifest.job = { id: randomUUID(), agent: id, state: 'installing', phase: 'Checking installation', logs: '' }
    try { await this.save() } catch (error) { this.manifest.job.state = 'failed'; throw error }
    void this.execute(id)
    return this.job!
  }
  private async execute(id: InstallableAgent): Promise<void> {
    const job = this.manifest.job!
    let stage: string | undefined
    const log = (text: string): void => { job.logs = (job.logs + text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).slice(-32_768) }
    try {
      const current = await this.inspect(id)
      if (current.path && !current.managed) throw new Error('An existing external installation was found. Use its official update or repair instructions; setup will not replace it.')
      if (this.options.active?.(id)) throw new Error('Close this agent’s sessions before installing or updating it.')
      // Also protect native destinations hidden by another PATH entry.
      const native = id === 'gemini' ? join(this.home, '.local/bin/agy') : id === 'opencode' ? join(this.home, '.opencode/bin/opencode') : id === 'grok' ? join(this.home, '.grok/bin/grok') : join(this.home, '.local/bin', id)
      if (id !== 'openclaude' && existsSync(native) && this.manifest.installations[id]?.path !== native) throw new Error(`An external installation exists at ${native}. Setup will not overwrite it.`)
      job.phase = 'Resolving stable release'
      const release: Release = await (this.options.resolveRelease ?? latestRelease)(id)
      job.version = release.version
      log(`Installing ${AGENT_REGISTRY[id].name} ${release.version} from ${release.source}\n`)
      await mkdir(this.tools, { recursive: true })
      stage = await mkdtemp(join(this.tools, '.setup-'))
      // Record ownership only after proving the destination was absent or ours.
      // A native installer can leave a binary behind even when verification fails.
      const ownedPath = id === 'openclaude' ? join(this.tools, 'bin/openclaude') : native
      this.manifest.installations[id] = this.manifest.installations[id] ?? { path: ownedPath, version: '', source: release.source, installedAt: new Date().toISOString() }
      await this.save()
      job.phase = 'Downloading and installing'
      const path = await (this.options.installer ?? installRelease)(id, release, { home: this.home, tools: this.tools, stage, log })
      job.phase = 'Verifying installation'
      const version = numericVersion(await this.probe(path))
      if (version !== release.version) throw new Error(`Version verification failed: expected ${release.version}, found ${version ?? 'unknown'}. Retry after checking the vendor release.`)
      const destination = id === 'openclaude' ? join(this.tools, 'bin/openclaude') : native
      if (path !== destination) await activateStaged(path, destination)
      this.manifest.installations[id] = { path: destination, version, source: release.source, installedAt: new Date().toISOString() }
      clearAgentProbeCache()
      const verified = await this.inspect(id)
      if (verified.state !== 'installed' || verified.path !== destination) throw new Error(`Launch-path verification failed: ${verified.detail ?? 'installed binary is shadowed by another executable'}. Check your setup and retry.`)
      job.state = 'installed'; job.phase = 'Installed — open the agent to configure your provider'
    } catch (error) { job.state = 'failed'; job.phase = 'Installation failed'; job.error = error instanceof Error ? error.message : String(error); log(`${job.error}\n`) }
    finally {
      this.cached = null
      if (stage) await rm(stage, { recursive: true, force: true }).catch(() => {})
      await this.save().catch(error => { job.state = 'failed'; job.error = `Could not save installation record: ${String(error)}` })
    }
  }
}
