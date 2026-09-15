import { Fragment, useEffect, useState } from 'react'
import type { AgentAccount, A2APeer, ApiProviderConfig, AppSettings, CloudBackup, CloudDeviceStart, CloudSpace, CloudUser } from '@shared/types'
import { AGENT_REGISTRY } from '@shared/agents/config'
import { HelpBadge } from './HelpBadge'
import { discoverAgentCard } from '../../../core/a2a/client'
import { parseRelayTermFrame, type RelayTermFrame } from '../../../core/relay-term'
import { useCanvasRequests } from '../state/canvas-requests'
import { useProjects } from '../state/projects'
import { applyTheme } from '../state/theme'
import { trustState, type TrustState } from './relay-trust'
import { Button, Card, FieldRow, Hint, PrefRow, Row, Section, Select, Status, TextArea, TextInput, Toggle } from './ui/kit'
import {
  CommandsPage,
  HooksPage,
  McpServersPage,
  PluginsPage,
  SkillsPage,
  SubagentsPage,
  UsagePage
} from './CapabilityPages'

interface AppSettingsPanelProps {
  onClose: () => void
  /** Notify the parent (App) whenever settings change, so live-settings like
   * invert-wheel-zoom propagate without reopening the panel. */
  onSettingsChange?: (settings: AppSettings) => void
}

/** The primary agent CLIs the product is built around (shown first in the
 * agents section). Claude stays registered but is optional/secondary. */
const PRIMARY_AGENTS = ['codex', 'grok'] as const

// The two panel rows that make up the General tab's pref selects.
type PresetMode = 'standard' | 'fast' | 'full'
type PermissionMode = 'workspaceWrite' | 'readOnly' | 'fullAccess'
type EnterBehavior = 'queue' | 'send' | 'prompt'
type ThemeChoice = 'light' | 'dark' | 'system'

const PRESET_MODES: { value: PresetMode; label: string }[] = [
  { value: 'standard', label: 'Standard mode' },
  { value: 'fast', label: 'Fast mode' },
  { value: 'full', label: 'Full mode' }
]

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'workspaceWrite', label: 'Workspace Write' },
  { value: 'readOnly', label: 'Read Only' },
  { value: 'fullAccess', label: 'Full Access' }
]

const ENTER_BEHAVIORS: { value: EnterBehavior; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'send', label: 'Send' },
  { value: 'prompt', label: 'Prompt' }
]

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

/** A settings-panel section. Adding one to a tab's render array adds content
 * to that sidebar tab — the extension point for future settings. `editions`
 * omits the current edition → the section is dropped from the panel (the
 * canvas shows only what the Server Edition implements). */
interface SettingsSection {
  id: string
  /** Card heading. Omitted by pages that lay out their own titled groups
   * (Skills, Hooks, Commands, MCP, Usage) — `bare` says so explicitly. */
  title?: string
  /** Render the section's output directly, without the panel's card wrapper:
   * the section already renders the cards it wants. */
  bare?: boolean
  editions?: EditionKind[]
  render: (ctx: SectionCtx) => React.JSX.Element
}

interface SectionCtx {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>
  permissionSupported: boolean
  addAccount: () => Promise<void>
  deleteAccount: (id: string) => Promise<void>
  setActive: (id: string | null) => Promise<void>
  setPermissionMode: (id: string, mode: AgentAccount['permissionMode']) => Promise<void>
  loginInto: (acc: AgentAccount) => Promise<void>
  newLabel: string
  setNewLabel: (v: string) => void
  confirmDelete: string | null
  setConfirmDelete: (v: string | null) => void
  cloudUser: CloudUser | null
  cloudBusy: boolean
  device: CloudDeviceStart | null
  lastBackup: CloudBackup | null
  space: CloudSpace | null
  spaceBusy: boolean
  spaceError: string | null
  /** Status line for the last space sync action (pulled project / pushed bytes / nothing online). */
  spaceNote: string | null
  /** False while the panel has not yet learned whether the user has a space. */
  spaceLoaded: boolean
  cloudSignIn: () => Promise<void>
  cloudSignOut: () => Promise<void>
  cloudBackupNow: () => Promise<void>
  cloudOpenSpace: () => Promise<void>
  /** GitHub connection row (Task 4): connected state + connect/disconnect. */
  ghConnected: boolean
  ghBusy: boolean
  ghNote: string | null
  ghConnect: () => Promise<void>
  ghDisconnect: () => Promise<void>
  /** D1 — pull the online snapshot into a NEW local project and open it. */
  cloudOpenSnapshot: () => Promise<void>
  /** D2 — push the active project's nodes + scrollbacks to the space. */
  cloudSyncProject: () => Promise<void>
  /** Phase 16 — save the ENTIRE workspace as ONE json file. */
  workspaceExportBundle: () => Promise<void>
  /** Phase 16 — open a saved bundle and land it as NEW local projects. */
  workspaceImportBundle: () => Promise<void>
}

type PageId =
  | 'general'
  | 'appearance'
  | 'models'
  | 'browser'
  | 'skills'
  | 'hooks'
  | 'commands'
  | 'plugins'
  | 'subagents'
  | 'mcp'
  | 'accounts'
  | 'a2a'
  | 'usage'
  | 'cloud'
  | 'connections'
  | 'updates'
/** Which edition is rendering this panel: the desktop app (full surface) or
 * the Server Edition canvas in a browser (only what the server actually
 * implements — no auto-update, no native dialogs, no desktop-only
 * integrations). Read from the bridge's runtime hint. */
type EditionKind = 'desktop' | 'server'

interface SettingsPage {
  id: PageId
  title: string
  /** One line under the page title saying what the page is for. Omitted when
   * the title already says it — the reference does the same ("Model settings"
   * carries a line, "General" does not). */
  description?: string
  icon: React.JSX.Element
  /** Editions this page applies to (undefined = both). */
  editions?: EditionKind[]
}

/** Sidebar groups, in reading order: what the app is (Basics), what it does
 * for your agents (Agent capabilities), what it keeps for you (Data and
 * statistics). Labels are sentence case and muted — an uppercase eyebrow over
 * every group would shout on every page. */
interface NavGroup {
  label: string
  pages: SettingsPage[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Basics',
    pages: [
      {
        id: 'general',
        title: 'General',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="21" y1="6" x2="15" y2="6" />
            <line x1="10" y1="6" x2="3" y2="6" />
            <line x1="21" y1="12" x2="13" y2="12" />
            <line x1="8" y1="12" x2="3" y2="12" />
            <line x1="21" y1="18" x2="16" y2="18" />
            <line x1="11" y1="18" x2="3" y2="18" />
            <line x1="13" y1="4" x2="13" y2="8" />
            <line x1="11" y1="10" x2="11" y2="14" />
            <line x1="14" y1="16" x2="14" y2="20" />
          </svg>
        )
      },
      {
        id: 'appearance',
        title: 'Appearance',
        description: 'How the workspace looks: theme, canvas, and node styling.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.2-1.8 3.5-3.6 3.5h-1.6a1.9 1.9 0 0 0-1.4 3.1A1.8 1.8 0 0 1 12 21z" />
            <circle cx="8" cy="11" r="1" />
            <circle cx="11" cy="7.5" r="1" />
            <circle cx="15.5" cy="8" r="1" />
          </svg>
        )
      },
      {
        id: 'models',
        title: 'Model settings',
        description: 'Manage custom model providers. Once configured, they can be selected in chat nodes.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 8l-9-5-9 5 9 5 9-5z" />
            <path d="M3 8v8l9 5 9-5V8" />
            <path d="M12 13v8" />
          </svg>
        )
      },
      {
        id: 'browser',
        title: 'Browser',
        description: 'Embedded browser nodes: where they start, and whether agents may drive them.',
        editions: ['desktop'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
          </svg>
        )
      }
    ]
  },
  {
    label: 'Agent capabilities',
    pages: [
      {
        id: 'skills',
        title: 'Skills',
        description: 'Skills the agent CLIs on this machine will load, and where each one came from.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20l7-7" />
            <path d="M14 4l1.2 3.3L18.5 8.5l-3.3 1.2L14 13l-1.2-3.3L9.5 8.5l3.3-1.2z" />
            <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7z" />
          </svg>
        )
      },
      {
        id: 'hooks',
        title: 'Hooks',
        description: 'The hooks each agent CLI will run — ours, and any other tool\'s we can see.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="5" r="2.5" />
            <path d="M12 7.5V15a4.5 4.5 0 0 0 9 0v-1.5" />
            <path d="M18.5 11.5L21 13.5l-2.5 2" />
          </svg>
        )
      },
      {
        id: 'commands',
        title: 'Commands',
        description: 'Slash commands the chat node intercepts before sending a message.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7l5 5-5 5" />
            <path d="M12 17h8" />
          </svg>
        )
      },
      {
        id: 'mcp',
        title: 'MCP Servers',
        description: 'MCP servers declared in the agent CLIs\' own config — read-only, because that is what actually launches.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="7" rx="2" />
            <rect x="3" y="13" width="18" height="7" rx="2" />
            <path d="M7 7.5h.01M7 16.5h.01" />
          </svg>
        )
      },
      {
        id: 'subagents',
        title: 'Subagents',
        description: 'Reusable subagent definitions the CLIs load, and what each one may do.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <path d="M8 9h4" />
            <path d="M8 13h7" />
            <path d="M9 21h6" />
          </svg>
        )
      },
      {
        id: 'plugins',
        title: 'Plugins',
        description: 'Plugin bundles cached by the agent CLIs, and whether each one is enabled.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
          </svg>
        )
      },
      {
        id: 'accounts',
        title: 'Agent accounts',
        description: 'Managed logins for the agent CLIs, and the permission mode each one runs with.',
        editions: ['desktop'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9l3 3-3 3" />
            <path d="M13 15h4" />
          </svg>
        )
      },
      {
        id: 'a2a',
        title: 'A2A peers',
        description: 'Agent-to-agent endpoints: which peers you trust, and whether your own nodes are exposed.',
        editions: ['desktop'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 3l-1.5 1.5" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21l1.5-1.5" />
          </svg>
        )
      }
    ]
  },
  {
    label: 'Data and statistics',
    pages: [
      {
        id: 'usage',
        title: 'Usage',
        description: 'Tokens and cost across your chat nodes, once a conversation has run.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20V10" />
            <path d="M10 20V4" />
            <path d="M16 20v-7" />
            <path d="M22 20H2" />
          </svg>
        )
      },
      {
        id: 'cloud',
        title: 'Cloud & backup',
        description: 'Your account, encrypted workspace backups, and the hosted canvas space.',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.2 9.2 4 4 0 0 0 7 19h10.5z" />
          </svg>
        )
      },
      {
        id: 'connections',
        title: 'Connections',
        description: 'Telegram and the relay service: how this machine talks to your phone and to other machines.',
        editions: ['desktop'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 7V3" />
            <path d="M15 7V3" />
            <path d="M6 7h12v4a6 6 0 0 1-12 0V7z" />
            <path d="M12 17v4" />
          </svg>
        )
      },
      {
        id: 'updates',
        title: 'Updates',
        description: 'Release channel, download behaviour, and what changed.',
        editions: ['desktop'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 4v5h-5" />
          </svg>
        )
      }
    ]
  }
]

/** Every page, in nav order — the lookup the renderer uses per page id. */
const PAGES: SettingsPage[] = NAV_GROUPS.flatMap((g) => g.pages)

export function AppSettingsPanel({ onClose, onSettingsChange }: AppSettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    autoDownloadUpdates: false,
    accounts: [],
    activeAccountId: null,
    dismissedAnnouncementVersion: null,
    a2aPeers: [],
    apiProviders: [],
    theme: 'system',
    enterBehavior: 'queue',
    agentBrowserControl: false,
    agentA2aServer: false
  })
  const [permissionSupported, setPermissionSupported] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [device, setDevice] = useState<CloudDeviceStart | null>(null)
  const [lastBackup, setLastBackup] = useState<CloudBackup | null>(null)
  const [space, setSpace] = useState<CloudSpace | null>(null)
  const [spaceBusy, setSpaceBusy] = useState(false)
  const [spaceError, setSpaceError] = useState<string | null>(null)
  const [spaceNote, setSpaceNote] = useState<string | null>(null)
  const [spaceLoaded, setSpaceLoaded] = useState(false)
  const [tab, setTab] = useState<PageId>('general')
  // Which edition is serving this renderer — the bridge carries the hint.
  const edition: EditionKind = window.termsprawl.runtime?.kind === 'server' ? 'server' : 'desktop'
  const isDesktop = edition === 'desktop'
  // electron-updater is only real in a packaged build (dev = documented no-op);
  // the updates section hides its toggle there. Defaults true so a slow
  // runtimeInfo answer never flashes the toggle away after paint.
  const [isPackaged, setIsPackaged] = useState(true)
  useEffect(() => {
    void window.termsprawl.runtimeInfo?.().then((r) => setIsPackaged(r.packaged)).catch(() => {})
  }, [])
  // Drafts for the A2A + API add forms.
  const [peerLabel, setPeerLabel] = useState('')
  const [peerEndpoint, setPeerEndpoint] = useState('')
  const [peerToken, setPeerToken] = useState('')
  const [peerTestId, setPeerTestId] = useState<string | null>(null)
  const [peerTestNote, setPeerTestNote] = useState<string | null>(null)
  const [providerName, setProviderName] = useState('')
  const [providerBaseUrl, setProviderBaseUrl] = useState('')

  useEffect(() => {
    void window.termsprawl.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme ?? 'system')
    })
    void window.termsprawl.settings.permissionSupported().then(setPermissionSupported)
    void window.termsprawl.cloud.status().then(setCloudUser).catch(() => setCloudUser(null))
    void window.termsprawl.cloud
      .spaceStatus()
      .then(setSpace)
      .catch(() => setSpace(null))
      .finally(() => setSpaceLoaded(true))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const next = await window.termsprawl.settings.set(patch)
    setSettings(next)
    onSettingsChange?.(next)
    if (patch.theme) applyTheme(patch.theme)
    return next
  }

  const toggleAutoDownload = async (checked: boolean): Promise<void> => {
    await update({ autoDownloadUpdates: checked })
  }

  const addAccount = async (): Promise<void> => {
    const next = await window.termsprawl.settings.createAccount(newLabel.trim() || 'account')
    setSettings(next)
    setNewLabel('')
  }

  const setActive = async (id: string | null): Promise<void> => {
    await update({ activeAccountId: id })
  }

  const setPermissionMode = async (id: string, mode: AgentAccount['permissionMode']): Promise<void> => {
    await update({ accounts: settings.accounts.map((a) => (a.id === id ? { ...a, permissionMode: mode } : a)) })
  }

  const loginInto = async (acc: AgentAccount): Promise<void> => {
    if (settings.activeAccountId !== acc.id) await update({ activeAccountId: acc.id })
    const command = await window.termsprawl.settings.loginCommand()
    useCanvasRequests.getState().spawn({ kind: 'agentLogin', command })
    onClose()
  }

  const deleteAccount = async (id: string): Promise<void> => {
    const next = await window.termsprawl.settings.deleteAccount(id)
    setSettings(next)
    setConfirmDelete(null)
  }

  const addPeer = async (): Promise<void> => {
    const label = peerLabel.trim()
    const endpoint = peerEndpoint.trim()
    if (!label || !endpoint) return
    const token = peerToken.trim()
    await update({
      a2aPeers: [
        ...(settings.a2aPeers ?? []),
        { id: crypto.randomUUID(), label, endpoint, ...(token ? { token } : {}) }
      ]
    })
    setPeerLabel('')
    setPeerEndpoint('')
    setPeerToken('')
  }

  const testPeer = async (peer: A2APeer): Promise<void> => {
    setPeerTestId(peer.id)
    setPeerTestNote('testing…')
    const envToken = process.env[`TERMSPRAWL_A2A_PEER_TOKEN_${peer.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]
    try {
      const res = await discoverAgentCard(peer.endpoint, {
        token: envToken || peer.token,
        timeoutMs: 8000
      })
      if (res.ok) setPeerTestNote(`✓ ${res.card.name}`)
      else setPeerTestNote(`✗ ${res.error}`)
    } catch (err) {
      setPeerTestNote(`✗ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const removePeer = async (id: string): Promise<void> => {
    await update({ a2aPeers: (settings.a2aPeers ?? []).filter((p) => p.id !== id) })
  }

  const addProvider = async (): Promise<void> => {
    const name = providerName.trim()
    const baseUrl = providerBaseUrl.trim()
    if (!name || !baseUrl) return
    await update({ apiProviders: [...(settings.apiProviders ?? []), { id: crypto.randomUUID(), name, baseUrl }] })
    setProviderName('')
    setProviderBaseUrl('')
  }

  const removeProvider = async (id: string): Promise<void> => {
    await update({ apiProviders: (settings.apiProviders ?? []).filter((p) => p.id !== id) })
  }

  // Termsprawl Cloud — GitHub device flow (from the cloud track): main opens the
  // verification page, we show the user_code and poll until the user approves.
  const cloudSignIn = async (): Promise<void> => {
    if (cloudBusy) return
    setCloudBusy(true)
    setDevice(null)
    try {
      const start = await window.termsprawl.cloud.deviceStart()
      setDevice(start)
      let user: CloudUser | null = null
      for (let i = 0; i < 120 && !user; i++) {
        await new Promise((r) => setTimeout(r, (start.interval || 5) * 1000))
        const p = await window.termsprawl.cloud.devicePoll(start.device_code)
        if (p.status === 'ok' && p.user) user = p.user
      }
      setDevice(null)
      setCloudUser(user)
    } finally {
      setCloudBusy(false)
    }
  }

  const cloudSignOut = async (): Promise<void> => {
    await window.termsprawl.cloud.signOut()
    setCloudUser(null)
    setLastBackup(null)
    setGhConnected(false)
  }

  // GitHub connection row (Task 4): the repo scope rides the existing device
  // flow, so "Connect GitHub" just runs the same sign-in; after a successful
  // sign-in we ask the cloud whether the vault holds a repo-scoped token by
  // probing the repo listing. Disconnect wipes the cloud vault token
  // (DELETE /github/connection).
  const [ghConnected, setGhConnected] = useState(false)
  const [ghBusy, setGhBusy] = useState(false)
  const [ghNote, setGhNote] = useState<string | null>(null)

  // GitHub is a CLOUD feature, not a desktop-local one: the space imports
  // repos too (the space container clones via the cloud broker). The
  // connection row shows on both editions when the cloud is reachable.
  const ghRelevant = isDesktop || cloudUser !== null

  const refreshGhConnected = async (): Promise<boolean> => {
    if (!cloudUser) {
      setGhConnected(false)
      return false
    }
    try {
      const res = await window.termsprawl.github.repos()
      setGhConnected(res.ok)
      return res.ok
    } catch {
      setGhConnected(false)
      return false
    }
  }

  useEffect(() => {
    void refreshGhConnected()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUser])

  const ghConnect = async (): Promise<void> => {
    if (ghBusy) return
    setGhBusy(true)
    setGhNote(null)
    try {
      // Same device flow as the cloud sign-in — the repo scope rides it.
      await cloudSignIn()
      const connected = await refreshGhConnected()
      // A grant that predates repo scope needs a re-approval on the GitHub
      // side; surface it instead of claiming success.
      setGhNote(connected ? null : 'GitHub connected, but repo access is missing — disconnect, then connect again and approve the repo scope')
    } finally {
      setGhBusy(false)
    }
  }

  const ghDisconnect = async (): Promise<void> => {
    if (ghBusy) return
    setGhBusy(true)
    setGhNote(null)
    try {
      const res = await window.termsprawl.github.disconnect()
      if (res.ok) {
        setGhConnected(false)
        setGhNote('GitHub disconnected — the stored token was removed')
      } else {
        setGhNote(res.message)
      }
    } finally {
      setGhBusy(false)
    }
  }

  const cloudBackupNow = async (): Promise<void> => {
    setLastBackup(await window.termsprawl.cloud.backupNow())
  }

  // Online canvas spaces (Pro): main mints the short-lived access token and
  // opens the returned URL — which carries the auth — in the system browser.
  const cloudOpenSpace = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    try {
      await window.termsprawl.cloud.openSpace()
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not open your online canvas')
    } finally {
      setSpaceBusy(false)
    }
  }

  // D1 — "Open online snapshot": main pulls the space content and imports the
  // current project as a NEW local project (collision-safe name, scrollbacks
  // persisted for the cold-start replay). On success the canvas switches to
  // the fresh project via the one-shot canvas request store; the panel closes
  // so the user actually sees it.
  const cloudOpenSnapshot = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.cloud.pullSpace()
      if (result.empty) {
        setSpaceNote('No online snapshot yet — sync a project first')
        return
      }
      // Cache the raw persisted nodes (the store's serialized shape — Canvas
      // runs deserializeNodes on switch, the same path a boot load uses) and
      // make the new project active.
      useProjects.getState().adopt(result.project, result.nodes)
      useCanvasRequests.getState().spawn({ kind: 'switchProject', projectId: result.project.id })
      onClose()
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not open the online snapshot')
    } finally {
      setSpaceBusy(false)
    }
  }

  // D2 — "Sync this project online": push the ACTIVE project's nodes +
  // scrollbacks. Main provisions a space first when the user has none; free
  // plans surface 403 upgrade_required here like every other cloud error.
  const cloudSyncProject = async (): Promise<void> => {
    if (spaceBusy) return
    const activeId = useProjects.getState().activeProjectId
    if (!activeId) {
      setSpaceError('No active project to sync')
      return
    }
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.cloud.pushSpace(activeId)
      setSpaceNote(
        `Synced "${useProjects.getState().projects.find((p) => p.id === activeId)?.name ?? 'project'}" online${result.provisioned ? ' (space provisioned)' : ''}`
      )
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not sync the project online')
    } finally {
      setSpaceBusy(false)
    }
  }

  // Phase 16 — "Export workspace…": main gathers the ENTIRE workspace (index,
  // every project's nodes, every terminal's scrollback) into ONE json file via
  // the save dialog. Canceled dialog = silent no-op.
  const workspaceExportBundle = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.workspace.exportBundle()
      setSpaceNote(result.saved ? `Workspace saved to ${result.path}` : null)
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not export the workspace')
    } finally {
      setSpaceBusy(false)
    }
  }

  // Phase 16 — "Open workspace…": a saved bundle lands as NEW local projects
  // (collision-safe names, terminal ids remapped on collision, scrollbacks
  // persisted for replay). On success the canvas switches to the first
  // imported project the same way the online-snapshot flow does.
  const workspaceImportBundle = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.workspace.importBundle()
      if (result.imported === 0 || !result.firstProjectId) {
        return // dialog canceled — nothing to report
      }
      // Refresh the projects store from disk (the import happened in main),
      // then switch the canvas to the first imported project via the one-shot
      // canvas request — the exact D1 sequence.
      await useProjects.getState().load()
      useCanvasRequests.getState().spawn({ kind: 'switchProject', projectId: result.firstProjectId })
      onClose()
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not open the workspace file')
    } finally {
      setSpaceBusy(false)
    }
  }

  const ctx: SectionCtx = {
    settings,
    update,
    permissionSupported,
    addAccount,
    deleteAccount,
    setActive,
    setPermissionMode,
    loginInto,
    newLabel,
    setNewLabel,
    confirmDelete,
    setConfirmDelete,
    cloudUser,
    cloudBusy,
    device,
    lastBackup,
    space,
    spaceBusy,
    spaceError,
    spaceNote,
    spaceLoaded,
    cloudSignIn,
    cloudSignOut,
    cloudBackupNow,
    cloudOpenSpace,
    ghConnected,
    ghBusy,
    ghNote,
    ghConnect,
    ghDisconnect,
    cloudOpenSnapshot,
    cloudSyncProject,
    workspaceExportBundle,
    workspaceImportBundle
  }

  // Sidebar tabs, grouped by termsprawl domain, filtered by edition. Each tab
  // hosts the sections that actually belong to it; a section whose `editions`
  // omits the current one is dropped — the canvas panel only shows controls
  // the Server Edition actually implements.
  const allSections: Record<PageId, SettingsSection[]> = {
    general: [
      { id: 'interaction',
        title: 'Interaction',
        render: (c) => (
          <>
            <PrefRow
              label="Enter behavior while busy"
              sub="In chat nodes: Enter sends; a busy session queues, sends, or prompts. Shift+Enter breaks the line"
            >
              <Select
                value={c.settings.enterBehavior ?? 'queue'}
                aria-label="Enter behavior while busy"
                onChange={(e) => void c.update({ enterBehavior: e.target.value })}
              >
                {ENTER_BEHAVIORS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </Select>
            </PrefRow>

            <PrefRow
              label="Terminal font"
              sub="Font family used by terminal nodes"
            >
              <TextInput
                value={c.settings.terminalFontFamily ?? ''}
                aria-label="Terminal font"
                onChange={(e) => void c.update({ terminalFontFamily: e.target.value })}
              />
            </PrefRow>

            <PrefRow
              label="Inherited terminal profile"
              sub="Profile name exposed to spawned terminal processes"
            >
              <TextInput
                value={c.settings.terminalProfile ?? ''}
                aria-label="Inherited terminal profile"
                onChange={(e) => void c.update({ terminalProfile: e.target.value })}
              />
            </PrefRow>

            <PrefRow
              label="HTTP proxy"
              sub="Inherited by terminal and agent processes when set"
            >
              <TextInput
                value={c.settings.httpProxy ?? ''}
                aria-label="HTTP proxy"
                placeholder="http://proxy.example:8080"
                onChange={(e) => void c.update({ httpProxy: e.target.value })}
              />
            </PrefRow>

            <PrefRow
              label="Invert mousewheel zoom"
              sub="Off (default): scroll up zooms in. On: scroll up zooms out"
            >
              <Toggle
                checked={c.settings.invertWheelZoom === true}
                onChange={(v) => void c.update({ invertWheelZoom: v })}
                ariaLabel="Invert mousewheel zoom"
              />
            </PrefRow>
          </>
        )
      },
      {
        id: 'firstrun',
        title: 'First run',
        render: (c) => (
          <PrefRow
            label="Show the welcome guide again"
            sub="Replays the 3-step welcome (create a project, spawn a terminal, arrange) the next time the canvas is empty"
          >
            <Button onClick={() => void c.update({ onboardedAt: undefined })}>Reset</Button>
          </PrefRow>
        )
      }
    ],
    appearance: [
      {
        id: 'theme',
        title: 'Theme',
        render: (c) => (
          <div className="grid grid-cols-3 gap-2.5 py-3" role="group" aria-label="Theme">
            {THEMES.map((t) => {
              const selected = (c.settings.theme ?? 'system') === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={selected}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3.5 transition-[color,background-color,border-color,transform] duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink active:scale-[0.98] ${
                    selected
                      ? 'border-ink bg-raised text-ink'
                      : 'border-edge text-mute hover:border-raised hover:bg-hover hover:text-ink'
                  }`}
                  onClick={() => void c.update({ theme: t.value })}
                >
                  <span className="flex h-[22px] items-center justify-center">{themeIcon(t.value)}</span>
                  <span className="text-xs">{t.label}</span>
                </button>
              )
            })}
          </div>
        )
      }
    ],
    models: [
      {
        id: 'providers',
        title: 'Providers',
        render: (c) => (
          <ApiSection
            providers={c.settings.apiProviders ?? []}
            providerName={providerName}
            providerBaseUrl={providerBaseUrl}
            setProviderName={setProviderName}
            setProviderBaseUrl={setProviderBaseUrl}
            addProvider={addProvider}
            removeProvider={removeProvider}
          />
        )
      },
      {
        id: 'chat',
        title: 'Defaults and keys',
        render: (c) => <ChatSection ctx={c} />
      }
    ],
    browser: [
      {
        id: 'home',
        title: 'Start page',
        render: (c) => (
          <PrefRow
            label="Home page"
            sub="URL opened when a browser node or new tab starts — point this at your own SearXNG (e.g. http://127.0.0.1:8080 or a LAN host) for private search. Empty = DuckDuckGo"
          >
            <TextInput
              placeholder="https://duckduckgo.com"
              spellCheck={false}
              value={c.settings.browserHomeUrl ?? ''}
              onChange={(e) => void c.update({ browserHomeUrl: e.target.value })}
            />
          </PrefRow>
        )
      },
      {
        id: 'agentcontrol',
        title: 'Agent control',
        render: (c) => (
          <PrefRow
            label="Allow agents to control browser nodes"
            sub="Off (default): embedded browsers work normally but no agent endpoint exists. On: an external agent can open and drive browser nodes over a localhost-only CDP endpoint"
          >
            <Toggle
              checked={c.settings.agentBrowserControl === true}
              onChange={(v) => void c.update({ agentBrowserControl: v })}
              ariaLabel="Allow agents to control browser nodes"
            />
          </PrefRow>
        )
      }
    ],
    accounts: [
      // Canvas: the agent registry is desktop-main-only — chat-node defaults
      // live in Model settings on both editions.
      { id: 'agents', title: 'Agents', editions: ['desktop'], render: () => <AgentsSection /> },
      {
        id: 'accounts',
        title: 'Agent accounts',
        editions: ['desktop'],
        render: (c) => (
          <AccountsSection
            settings={c.settings}
            permissionSupported={permissionSupported}
            addAccount={addAccount}
            deleteAccount={deleteAccount}
            setActive={setActive}
            setPermissionMode={setPermissionMode}
            loginInto={loginInto}
            newLabel={newLabel}
            setNewLabel={setNewLabel}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
          />
        )
      }
    ],
    a2a: [
      {
        id: 'expose',
        title: 'Your nodes',
        editions: ['desktop'],
        render: (c) => (
          <PrefRow
            label="Expose agent nodes to A2A peers"
            sub="Off (default): no A2A endpoint exists. On: your live agent terminals are listed as agents at a localhost-only endpoint — peers send tasks via the Google A2A protocol (token in userData/a2a-agent.json)"
          >
            <Toggle
              checked={c.settings.agentA2aServer === true}
              onChange={(v) => void c.update({ agentA2aServer: v })}
              ariaLabel="Expose agent nodes to A2A peers"
            />
          </PrefRow>
        )
      },
      {
        id: 'a2a',
        title: 'Peers',
        editions: ['desktop'],
        render: (c) => (
          <A2ASection
            peers={c.settings.a2aPeers ?? []}
            peerLabel={peerLabel}
            peerEndpoint={peerEndpoint}
            peerToken={peerToken}
            setPeerLabel={setPeerLabel}
            setPeerEndpoint={setPeerEndpoint}
            setPeerToken={setPeerToken}
            addPeer={addPeer}
            removePeer={removePeer}
            testPeer={testPeer}
            peerTestId={peerTestId}
            peerTestNote={peerTestNote}
          />
        )
      }
    ],
    cloud: [
      {
        id: 'user',
        title: isDesktop ? 'Account' : 'Cloud',
        render: (c) => <UserSection ctx={c} />
      }
    ],
    connections: [
      {
        id: 'telegram',
        title: 'Telegram bot',
        editions: ['desktop'],
        render: (c) => <TelegramSection ctx={c} />
      },
      {
        id: 'relay',
        title: 'Relay',
        editions: ['desktop'],
        render: (c) => <RelaySection ctx={c} />
      }
    ],
    updates: [
      { id: 'updates', title: 'Release', render: (c) => <UpdatesSection ctx={c} isPackaged={isPackaged} /> }
    ],
    skills: [{ id: 'skills', bare: true, render: () => <SkillsPage /> }],
    hooks: [{ id: 'hooks', bare: true, render: () => <HooksPage /> }],
    commands: [{ id: 'commands', bare: true, render: () => <CommandsPage /> }],
    mcp: [{ id: 'mcp', bare: true, render: () => <McpServersPage /> }],
    plugins: [{ id: 'plugins', bare: true, render: () => <PluginsPage /> }],
    subagents: [{ id: 'subagents', bare: true, render: () => <SubagentsPage /> }],
    usage: [{ id: 'usage', bare: true, render: () => <UsagePage /> }]
  }

  // Pages this edition can render, and the one actually on screen: a page the
  // edition hides (Browser on a canvas, Updates in a container) snaps back to
  // the first visible page rather than rendering an empty shell.
  const visiblePages = PAGES.filter((p) => !p.editions || p.editions.includes(edition))
  const activePage = visiblePages.find((p) => p.id === tab) ?? visiblePages[0]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="settings-panel relative flex h-[min(720px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-edge bg-page shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
        role="dialog"
        aria-modal="true"
        aria-label="settings"
      >
        {/* No title bar: the page title is the title, and Escape / "Back to
            workspace" / the window controls are the ways out (the reference has
            native window chrome in that corner). A visible close stays for
            pointer users, floating over the content gutter. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close settings"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-[7px] border border-transparent text-[15px] leading-none text-mute transition-colors hover:border-edge hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
        >
          ×
        </button>

        <div className="flex min-h-0 flex-1">
          <nav
            className="settings-scroll flex w-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-edge px-3 pb-3 pt-2"
            aria-label="settings sections"
          >
            <button
              type="button"
              onClick={onClose}
              className="group mb-1 flex items-center gap-2.5 rounded-lg py-2 pl-3.5 pr-2.5 text-left text-[13px] text-mute transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
            >
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5" />
                  <path d="M11 18l-6-6 6-6" />
                </svg>
              </span>
              <span className="truncate">Back to workspace</span>
            </button>
            {NAV_GROUPS.map((group) => {
              const pages = group.pages.filter(
                (p) => !p.editions || p.editions.includes(edition)
              )
              if (pages.length === 0) return null
              return (
                <div key={group.label} className="flex flex-col gap-0.5">
                  <div className="px-3 pb-1 pt-3 text-[11px] font-medium leading-none text-mute">
                    {group.label}
                  </div>
                  {pages.map((p) => {
                    const active = activePage.id === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        className={`group relative flex items-center gap-2.5 rounded-lg py-2 pl-3.5 pr-2.5 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
                          active
                            ? 'bg-raised font-medium text-ink'
                            : 'text-mute hover:bg-hover hover:text-ink'
                        }`}
                        onClick={() => setTab(p.id)}
                      >
                        {/* Active indicator: a short ink bar at the item's left
                            edge, so the current page reads at a glance. */}
                        <span
                          aria-hidden="true"
                          className={`absolute left-1 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-ink transition-opacity ${
                            active ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        <span
                          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center transition-colors ${
                            active ? 'text-ink' : 'text-mute group-hover:text-ink'
                          }`}
                        >
                          {p.icon}
                        </span>
                        <span className="truncate">{p.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          <div className="settings-scroll flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-7">
            <div className="flex min-w-0 max-w-[720px] flex-col gap-7">
              <header className="flex flex-col gap-1.5">
                <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  {activePage.title}
                </h1>
                {activePage.description && (
                  <p className="max-w-[68ch] text-[13px] leading-relaxed text-mute [text-wrap:pretty]">
                    {activePage.description}
                  </p>
                )}
              </header>
              {allSections[activePage.id]
                .filter((s) => !s.editions || s.editions.includes(edition))
                .map((section) =>
                  section.bare ? (
                    <Fragment key={section.id}>{section.render(ctx)}</Fragment>
                  ) : (
                    <Section key={section.id} title={section.title}>
                      {section.render(ctx)}
                    </Section>
                  )
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function themeIcon(theme: ThemeChoice): React.JSX.Element {
  if (theme === 'light') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  )
}

/** Short display label for a space URL from the API ("canvas.termsprawl.com/dazeb"). */
function spaceUrlLabel(space: CloudSpace): string {
  try {
    const u = new URL(space.url)
    return `${u.host}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return space.url
  }
}

function UserSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const {
    settings, update, cloudUser, cloudBusy, device, lastBackup,
    space, spaceBusy, spaceError, spaceNote, spaceLoaded,
    cloudSignIn, cloudSignOut, cloudBackupNow, cloudOpenSpace,
    ghConnected, ghBusy, ghNote, ghConnect, ghDisconnect,
    cloudOpenSnapshot, cloudSyncProject,
    workspaceExportBundle, workspaceImportBundle
  } = ctx
  // Edition: the space rows (open your online canvas / open snapshot / sync
  // this project) drive a DESKTOP↔space loop — from inside the space itself
  // they are meaningless (you ARE the space). Workspace export/import needs
  // native save dialogs — desktop-only. The GitHub connection row is a CLOUD
  // feature (the space imports repos via the broker) but the shim's github
  // stub rejects, so it only shows on desktop for now.
  const isDesktop = window.termsprawl.runtime?.kind !== 'server'
  // The upsell lands on the web dashboard's billing page — the same surface the
  // Stripe checkout/portal flows live on.
  const openBilling = (): void => {
    void window.termsprawl.openExternal(`${(settings.cloudApiBase ?? 'https://termsprawl.com').replace(/\/$/, '')}/dashboard/billing`)
  }
  return (
    <>
      {device && (
        <Hint>
          open <strong>{device.verification_uri}</strong> and enter code <strong>{device.user_code}</strong> to link this device.
        </Hint>
      )}
      {cloudUser ? (
        <>
          <Hint>
            signed in as {cloudUser.github_login} · {cloudUser.plan} plan. Backups are encrypted server-side with your key.
          </Hint>
          <Row>
            <Button variant="primary" onClick={() => void cloudBackupNow()}>back up now</Button>
            {lastBackup && <Status>backup {lastBackup.id.slice(0, 8)} · {lastBackup.size_bytes} bytes</Status>}
            <Button variant="danger" onClick={() => void cloudSignOut()}>sign out</Button>
          </Row>
          {isDesktop && (cloudUser.plan === 'pro' || cloudUser.plan === 'canvas') ? (
            <>
              <Row>
                <Button variant="primary" disabled={spaceBusy} onClick={() => void cloudOpenSpace()}>
                  {spaceBusy ? 'opening…' : 'open your online canvas'}
                </Button>
                {space && <Status>{spaceUrlLabel(space)} · {space.status}</Status>}
                {spaceError && <Status className="text-danger">{spaceError}</Status>}
                {spaceNote && <Status>{spaceNote}</Status>}
              </Row>
              <Row>
                {/* D1 — pull the online snapshot into a NEW local project and
                    switch to it. Disabled while busy; a space with nothing
                    online yet shows the note instead of failing. */}
                <Button
                  variant="primary"
                  disabled={spaceBusy || !spaceLoaded}
                  title={spaceLoaded ? undefined : 'checking your space…'}
                  onClick={() => void cloudOpenSnapshot()}
                >
                  {spaceBusy ? 'working…' : 'open online snapshot'}
                </Button>
                {/* D2 — push the active project's nodes + scrollbacks. Provisions
                    the space first when the user has none. */}
                <Button
                  variant="primary"
                  disabled={spaceBusy || !spaceLoaded}
                  title={spaceLoaded ? undefined : 'checking your space…'}
                  onClick={() => void cloudSyncProject()}
                >
                  {spaceBusy ? 'working…' : 'sync this project online'}
                </Button>
              </Row>
              {/* Phase 16 — the whole workspace as ONE json file: save/open
                  dialogs live in main; the same busy/error/note surface as the
                  spaces rows above. Works signed-in or not. */}
              <Row>
                <Button
                  variant="primary"
                  disabled={spaceBusy}
                  onClick={() => void workspaceExportBundle()}
                >
                  {spaceBusy ? 'working…' : 'export workspace…'}
                </Button>
                <Button
                  variant="primary"
                  disabled={spaceBusy}
                  onClick={() => void workspaceImportBundle()}
                >
                  {spaceBusy ? 'working…' : 'open workspace…'}
                </Button>
              </Row>
            </>
          ) : !isDesktop ? null : (
            <Row>
              <Button variant="primary" onClick={openBilling}>upgrade to pro</Button>
              <Status>pro adds an online canvas space that syncs with this desktop</Status>
            </Row>
          )}
        </>
      ) : (
        <Row>
          <Button variant="primary" disabled={cloudBusy} onClick={() => void cloudSignIn()}>
            {cloudBusy ? 'waiting for github…' : 'sign in with github'}
          </Button>
          {!isDesktop && <Status>sign in to sync this canvas with your desktop</Status>}
        </Row>
      )}
      {cloudUser && isDesktop && (
        <Row>
          {ghConnected ? (
            <>
              <Status>GitHub connected</Status>
              <Button variant="danger" disabled={ghBusy} onClick={() => void ghDisconnect()}>
                {ghBusy ? 'working…' : 'disconnect'}
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={ghBusy || cloudBusy} onClick={() => void ghConnect()}>
              {ghBusy || cloudBusy ? 'waiting for github…' : 'Connect GitHub'}
            </Button>
          )}
          {ghNote && <Status className="text-danger">{ghNote}</Status>}
        </Row>
      )}
      <Hint>
        {isDesktop
          ? 'Termsprawl Cloud account (sign in to back up projects). Settings live in settings.json in the config directory.'
          : 'Sign in with the same GitHub account as your desktop to sync projects between them. Cloud settings for this canvas are managed here; everything else lives on your desktop.'}
      </Hint>
    </>
  )
}

function UpdatesSection({ ctx, isPackaged }: { ctx: SectionCtx; isPackaged: boolean }): React.JSX.Element {
  // electron-updater only runs in a packaged build (dev is a documented
  // no-op) — hide the dead control instead of rendering a toggle that does
  // nothing. The Updates TAB itself is already desktop-only.
  if (!isPackaged) {
    return (
      <Hint>
        Updates come from GitHub Releases. This build is unpackaged (dev), so the
        updater is inactive. Launch the installed AppImage or .deb to manage
        updates.
      </Hint>
    )
  }
  return (
    <PrefRow
      label={
        <span className="inline-flex items-center gap-1.5">
          Auto download updates when available
          <HelpBadge
            label="about auto download"
            text="Off (default): a toast appears when a newer GitHub release exists; you choose when to download. On: the AppImage/.deb downloads in the background, then the toast asks you to restart."
          />
        </span>
      }
      sub="When off, you get a toast and choose when to download. When on, updates download in the background and you restart to install."
    >
      <Toggle
        checked={ctx.settings.autoDownloadUpdates}
        onChange={(v) => void ctx.update({ autoDownloadUpdates: v })}
        ariaLabel="auto download updates when available"
      />
    </PrefRow>
  )
}

function AgentsSection(): React.JSX.Element {
  return (
    <>
      <Hint>Primary agents: codex and grok. Open them from the canvas context menu (Open agent ▸). Claude stays registered but is optional.</Hint>
      {PRIMARY_AGENTS.map((id) => {
        const config = AGENT_REGISTRY[id]
        if (!config) return null
        return (
          <Row key={id}>
            <span className="text-ink">{config.name}</span>
            <Status>{config.command}</Status>
            <Status>{config.capabilities.hooks ? 'hooks' : 'no hooks'}</Status>
          </Row>
        )
      })}
    </>
  )
}

function AccountsSection(props: {
  settings: AppSettings
  permissionSupported: boolean
  addAccount: () => Promise<void>
  deleteAccount: (id: string) => Promise<void>
  setActive: (id: string | null) => Promise<void>
  setPermissionMode: (id: string, mode: AgentAccount['permissionMode']) => Promise<void>
  loginInto: (acc: AgentAccount) => Promise<void>
  newLabel: string
  setNewLabel: (v: string) => void
  confirmDelete: string | null
  setConfirmDelete: (v: string | null) => void
}): React.JSX.Element {
  const { settings, permissionSupported, addAccount, deleteAccount, setActive, setPermissionMode, loginInto, newLabel, setNewLabel, confirmDelete, setConfirmDelete } = props
  return (
    <>
      <Hint>Each account is its own local agent config directory. Pick the active account for new agents; none means the default. Inherited API keys are stripped from its spawns.</Hint>
      {settings.accounts.length === 0 && <Hint>no accounts yet — add one below.</Hint>}
      {settings.accounts.map((acc) => (
        <Row key={acc.id}>
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="activeAccount"
              className="accent-ink"
              checked={settings.activeAccountId === acc.id}
              onChange={() => void setActive(acc.id)}
            />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-ink">{acc.label}</span>
            <Status>{acc.id}</Status>
          </label>
          {permissionSupported && (
            <Select
              selectClassName="max-w-[130px]"
              value={acc.permissionMode ?? 'default'}
              title="permission mode"
              onChange={(e) => void setPermissionMode(acc.id, e.target.value as AgentAccount['permissionMode'])}
            >
              <option value="default">default</option>
              <option value="acceptEdits">accept edits</option>
              <option value="bypassPermissions">bypass</option>
            </Select>
          )}
          {!confirmDelete && <Button variant="primary" title="open a login terminal for this account" onClick={() => void loginInto(acc)}>login</Button>}
          {confirmDelete === acc.id ? (
            <span className="flex items-center gap-2">
              <Status className="text-danger">removes its local config dir</Status>
              <Button variant="danger" armed onClick={() => void deleteAccount(acc.id)}>confirm delete</Button>
              <button className="text-xs text-mute transition-colors hover:text-ink" onClick={() => setConfirmDelete(null)}>keep</button>
            </span>
          ) : (
            <Button variant="danger" title="delete this account" onClick={() => setConfirmDelete(acc.id)}>delete</Button>
          )}
        </Row>
      ))}
      <FieldRow>
        <TextInput grow value={newLabel} placeholder="account label" onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addAccount() }} />
        <Button variant="primary" onClick={() => void addAccount()}>add account</Button>
      </FieldRow>
    </>
  )
}

function A2ASection(props: {
  peers: A2APeer[]
  peerLabel: string
  peerEndpoint: string
  peerToken: string
  setPeerLabel: (v: string) => void
  setPeerEndpoint: (v: string) => void
  setPeerToken: (v: string) => void
  addPeer: () => Promise<void>
  removePeer: (id: string) => Promise<void>
  testPeer: (peer: A2APeer) => Promise<void>
  peerTestId: string | null
  peerTestNote: string | null
}): React.JSX.Element {
  const {
    peers, peerLabel, peerEndpoint, peerToken, setPeerLabel, setPeerEndpoint, setPeerToken,
    addPeer, removePeer, testPeer, peerTestId, peerTestNote
  } = props
  return (
    <>
      <Hint>Agent-to-agent peers you can route tasks to (canvas right-click → “A2A send to peer”). Peers speak the Google A2A protocol (JSON-RPC over HTTP).</Hint>
      {peers.map((p) => (
        <Row key={p.id}>
          <span className="text-ink">{p.label}</span>
          <Status>{p.endpoint}</Status>
          <Button title="discover the peer's agent card" onClick={() => void testPeer(p)}>test</Button>
          <Button variant="danger" onClick={() => void removePeer(p.id)}>remove</Button>
          {peerTestId === p.id && peerTestNote && (
            <Status className={peerTestNote.startsWith('✓') ? '' : 'text-danger'}>{peerTestNote}</Status>
          )}
        </Row>
      ))}
      <FieldRow>
        <TextInput grow value={peerLabel} placeholder="peer label" onChange={(e) => setPeerLabel(e.target.value)} />
        <TextInput grow value={peerEndpoint} placeholder="http://127.0.0.1:8787" onChange={(e) => setPeerEndpoint(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPeer() }} />
        <TextInput grow value={peerToken} placeholder="bearer token (optional)" onChange={(e) => setPeerToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPeer() }} />
        <Button variant="primary" onClick={() => void addPeer()}>add peer</Button>
      </FieldRow>
    </>
  )
}

function ApiSection(props: { providers: ApiProviderConfig[]; providerName: string; providerBaseUrl: string; setProviderName: (v: string) => void; setProviderBaseUrl: (v: string) => void; addProvider: () => Promise<void>; removeProvider: (id: string) => Promise<void> }): React.JSX.Element {
  const { providers, providerName, providerBaseUrl, setProviderName, setProviderBaseUrl, addProvider, removeProvider } = props
  return (
    <>
      <Hint>OSS/provider API endpoints for the chat and agent drivers. API keys are NOT stored here — add a keychain-backed field later if needed.</Hint>
      {providers.map((p) => (
        <Row key={p.id}>
          <span className="text-ink">{p.name}</span>
          <Status>{p.baseUrl}</Status>
          <Button variant="danger" onClick={() => void removeProvider(p.id)}>remove</Button>
        </Row>
      ))}
      <FieldRow>
        <TextInput grow value={providerName} placeholder="provider (e.g. xAI)" onChange={(e) => setProviderName(e.target.value)} />
        <TextInput grow value={providerBaseUrl} placeholder="https://api.x.ai/v1" onChange={(e) => setProviderBaseUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addProvider() }} />
        <Button variant="primary" onClick={() => void addProvider()}>add provider</Button>
      </FieldRow>
    </>
  )
}

/** Telegram bot (Phase 11 Task 11.3). Local bot the user's phone pairs with.
 * The token is the user's own bot secret — stored in settings.json on this
 * machine only (env TERMSPRAWL_TELEGRAM_TOKEN overrides it in dev). The
 * allowlist is the paired phone(s); empty = first /start becomes the owner. */
function TelegramSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  const tg = settings.telegram ?? { enabled: false, allowedChatIds: [] }
  const allowed = (tg.allowedChatIds ?? []).join('\n')
  const [draft, setDraft] = useState<{ token: string; allowed: string }>({
    token: tg.token ?? '',
    allowed
  })

  // Saves the whole telegram block; token only when the user typed a new one.
  const save = (patch: { enabled?: boolean; token?: string; allowedChatIds?: string[] }): void => {
    void update({
      telegram: {
        enabled: patch.enabled ?? tg.enabled === true,
        token: patch.token !== undefined ? patch.token : (tg.token ?? ''),
        allowedChatIds:
          patch.allowedChatIds !== undefined ? patch.allowedChatIds : (tg.allowedChatIds ?? [])
      }
    })
  }

  return (
    <>
      <Hint>
        Control termsprawl from your phone. Pair by messaging the bot with /start from
        the phone; the first chat becomes the owner unless you list chats below. The bot
        token is stored on this machine only — never committed to the repo (the
        TERMSPRAWL_TELEGRAM_TOKEN env var overrides it).
      </Hint>

      <PrefRow
        label="Enable Telegram bot"
        sub="On: the bot starts and watches for messages. Off (default): nothing runs"
      >
        <Toggle checked={tg.enabled === true} onChange={(v) => void save({ enabled: v })} ariaLabel="Enable Telegram bot" />
      </PrefRow>

      <PrefRow
        label="Bot token"
        sub={tg.token ? `a token is set (${tg.token.slice(-4)})` : 'no token — get one from @BotFather'}
      >
        <TextInput
          type="password"
          placeholder={tg.token ? '••••••••' : '123:bot-token'}
          spellCheck={false}
          value={draft.token}
          onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
          onBlur={() => {
            if (draft.token.trim() && draft.token !== (tg.token ?? '')) void save({ token: draft.token.trim() })
          }}
        />
      </PrefRow>

      <PrefRow
        label="Allowed chat ids"
        sub="empty = the first chat to /start becomes the owner; otherwise only these chats may issue commands"
      >
        <TextArea
          rows={3}
          placeholder="one chat id per line"
          spellCheck={false}
          value={draft.allowed}
          onChange={(e) => setDraft((d) => ({ ...d, allowed: e.target.value }))}
          onBlur={() =>
            void save({
              allowedChatIds: draft.allowed
                .split(/\n|,/)
                .map((s) => s.trim())
                .filter(Boolean)
            })
          }
        />
      </PrefRow>
    </>
  )
}

/** Relay (Phase 11 Task 11.2, surfaced by audit B7): dial target + role +
 * invite for the E2E-encrypted relay. Connect/disconnect live here too — the
 * runtime is idle unless explicitly dialed. The URL is non-secret config
 * (same class as apiProviders); invite codes are pair-once secrets stored on
 * this machine only. */
function RelaySection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  const relay = settings.relay ?? { role: 'host' as const }
  const isHost = relay.role !== 'client'
  const [draft, setDraft] = useState<{ url: string; invite: string }>({
    url: relay.url ?? '',
    invite: relay.invite ?? ''
  })
  const [conn, setConn] = useState<{ state: string; error: string | null }>({
    state: 'disconnected',
    error: null
  })
  const [busy, setBusy] = useState(false)
  const [pairing, setPairing] = useState<{
    peerLogin: string | null
    fingerprint: string
    decision: TrustState
  } | null>(null)
  const [mint, setMint] = useState<{ busy: boolean; code: string | null; error: string | null }>({
    busy: false,
    code: null,
    error: null
  })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    void window.termsprawl.relay.status().then((s) => {
      if (alive) setConn(s)
    })
    const off = window.termsprawl.relay.onStatus((s) => {
      if (alive) setConn(s)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const trusted = relay.trustedFingerprint
  const paired = conn.state === 'paired'
  const deciding = pairing !== null

  const saveRelay = (patch: {
    url?: string
    role?: 'host' | 'client'
    invite?: string
    /** string = set, null = clear, undefined = leave as-is. */
    trusted?: string | null
  }): void => {
    void update({
      relay: {
        url: patch.url !== undefined ? patch.url : (relay.url ?? ''),
        role: patch.role ?? (relay.role === 'client' ? 'client' : 'host'),
        invite: patch.invite !== undefined ? patch.invite : relay.invite,
        trustedFingerprint:
          patch.trusted !== undefined ? patch.trusted ?? undefined : relay.trustedFingerprint
      }
    })
  }

  /** Tear down any session and clear the ephemeral surfaces (invite code,
   * confirm card, copy flag) that only make sense while connected. */
  const teardown = (): void => {
    void window.termsprawl.relay.disconnect()
    setConn({ state: 'disconnected', error: null })
    setPairing(null)
    setCopied(false)
    setMint({ busy: false, code: null, error: null })
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setCopied(false)
    setMint({ busy: false, code: null, error: null })
    try {
      const res = await window.termsprawl.relay.connect()
      if (!res.ok) {
        setConn({ state: 'error', error: res.error ?? 'connect failed' })
        return
      }
      // The runtime pairs automatically; a peer key is only surfaced once a
      // peer is actually present. Gate trust on the user's explicit confirm.
      const p = res.pairing
      if (p?.fingerprint) {
        const decision = trustState(relay.trustedFingerprint, p.fingerprint)
        if (decision === 'confirm' || decision === 'mismatch') {
          setPairing({ peerLogin: p.peerLogin, fingerprint: p.fingerprint, decision })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const trustPeer = (): void => {
    if (!pairing) return
    // Persist the freshly eyeballed fingerprint — trust survives restarts.
    void saveRelay({ trusted: pairing.fingerprint })
    setPairing(null)
  }

  const forget = (): void => {
    teardown()
    void saveRelay({ trusted: null })
  }

  const mintInvite = async (): Promise<void> => {
    if (mint.busy) return
    setMint({ busy: true, code: null, error: null })
    setCopied(false)
    try {
      const res = await window.termsprawl.relay.mintInvite()
      if (res.ok && res.code) setMint({ busy: false, code: res.code, error: null })
      else setMint({ busy: false, code: null, error: res.error ?? 'could not mint an invite' })
    } catch (e) {
      setMint({ busy: false, code: null, error: e instanceof Error ? e.message : 'could not mint an invite' })
    }
  }

  const copyInvite = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setMint((m) => ({ ...m, error: 'could not copy the invite code' }))
    }
  }

  /** A short preview of a stored fingerprint for labels ("…last groups"). */
  const shortFp = (fp: string): string => {
    const groups = fp.trim().split(/\s+/).filter(Boolean)
    return groups.length > 2 ? `…${groups.slice(-2).join(' ')}` : fp
  }

  const peerName = pairing?.peerLogin ?? 'peer'

  return (
    <>
      <Hint>
        Pair two termsprawl instances through the E2E-encrypted relay. A host mints a
        single-use invite once the peers are paired; the other instance joins with that
        code as a client. Traffic is end-to-end encrypted — the relay only routes
        ciphertext. Both sides confirm the peer&apos;s key fingerprint before trusting it.
      </Hint>

      <PrefRow
        label="Relay URL"
        sub="wss:// address of the relay service"
      >
        <TextInput
          placeholder="wss://relay.example.com"
          spellCheck={false}
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          onBlur={() => {
            if (draft.url.trim() !== (relay.url ?? '')) void saveRelay({ url: draft.url.trim() })
          }}
        />
      </PrefRow>

      <PrefRow
        label="Role"
        sub="host exposes this machine; client connects out to a host"
      >
        <Select
          value={relay.role === 'client' ? 'client' : 'host'}
          aria-label="Relay role"
          onChange={(e) => void saveRelay({ role: e.target.value as 'host' | 'client' })}
        >
          <option value="host">host</option>
          <option value="client">client</option>
        </Select>
      </PrefRow>

      {isHost ? (
        <>
          <PrefRow
            label="Invite a peer"
            sub={
              paired && !deciding
                ? 'pairing ready — generate a single-use invite to share'
                : paired && deciding
                  ? 'confirm the peer’s fingerprint above before inviting'
                  : 'a peer must pair with this host before an invite can be minted'
            }
          >
            <Button
              variant="primary"
              disabled={!paired || deciding || mint.busy || busy}
              onClick={() => void mintInvite()}
            >
              {mint.busy ? 'Generating…' : 'Generate invite'}
            </Button>
          </PrefRow>
          {mint.error && <Hint className="text-danger">{mint.error}</Hint>}
          {mint.code && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-raised px-3 py-2 font-mono text-[15px] tracking-[0.08em] text-ink">
                <span>{mint.code}</span>
                <Button onClick={() => void copyInvite(mint.code as string)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Hint>Single-use, expires in 7 days. Share it out of band with the peer.</Hint>
            </>
          )}
        </>
      ) : (
        <PrefRow
          label="Invite code"
          sub={
            relay.invite ? `an invite is set (${relay.invite.slice(-4)})` : 'paste the invite code the host shared'
          }
        >
          <TextInput
            type="password"
            placeholder={relay.invite ? '••••••••' : 'invite code'}
            spellCheck={false}
            value={draft.invite}
            onChange={(e) => setDraft((d) => ({ ...d, invite: e.target.value }))}
            onBlur={() => {
              if (draft.invite.trim() !== (relay.invite ?? '')) void saveRelay({ invite: draft.invite.trim() })
            }}
          />
        </PrefRow>
      )}

      {!isHost && paired && !!trusted && !deciding && !busy && (
        // B3 — client side can open terminals the trusted host is serving. Only
        // once we are paired AND the peer fingerprint is trusted (relay-trust)
        // AND no confirm/mismatch card is pending.
        <RelayTerminalList />
      )}

      {pairing && pairing.decision === 'confirm' && (
        <Card
          title="Confirm this peer"
          sub={<>{peerName} — fingerprint:</>}
        >
          <span className="break-all font-mono text-xs text-ink">{pairing.fingerprint}</span>
          <div className="flex justify-end gap-2">
            <Button onClick={teardown}>
              Disconnect
            </Button>
            <Button variant="primary" onClick={trustPeer}>
              Trust this peer
            </Button>
          </div>
        </Card>
      )}

      {pairing && pairing.decision === 'mismatch' && (
        <Card
          title="Peer key changed — not trusted"
          danger
          sub={
            <>
              {peerName} now presents a different key than the fingerprint this machine
              trusted ({trusted ? shortFp(trusted) : 'none'}). You may be talking to a
              different machine. Re-trust only if you are certain.
            </>
          }
        >
          <span className="break-all font-mono text-xs text-ink">{pairing.fingerprint}</span>
          <div className="flex justify-end gap-2">
            <Button variant="danger" onClick={teardown}>
              Disconnect
            </Button>
            <Button variant="primary" onClick={trustPeer}>
              Trust this peer
            </Button>
          </div>
        </Card>
      )}

      <PrefRow
        label="Connection"
        sub={
          <>
            {conn.state}
            {paired && trusted ? ` — trusted peer (${shortFp(trusted)})` : ''}
            {conn.error ? ` — ${conn.error}` : ''}
          </>
        }
      >
        {trusted && (
          <Button variant="danger" onClick={forget} title="Forget the trusted peer and disconnect">
            Forget
          </Button>
        )}
        {paired || conn.state === 'connecting' ? (
          <Button variant="primary" disabled={busy} onClick={teardown}>
            Disconnect
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !relay.url} onClick={() => void connect()}>
            Connect
          </Button>
        )}
      </PrefRow>
    </>
  )
}

/**
 * B3 — "Remote terminals" list for the relay CLIENT: list the terminals a
 * trusted host is serving and open each as a remote terminal node on the
 * active project canvas. It subscribes to the frame stream only while mounted
 * (returned unsubscribe runs on unmount, so it never steals frames meant for
 * a remote terminal node — every listener receives every frame and filters by
 * kind/term). The term-list reply is matched by kind, not by a request id,
 * which is safe here because only this block ever sends a 'list' frame.
 */
function RelayTerminalList(): React.JSX.Element {
  const [terms, setTerms] = useState<Array<{ id: string; title: string }>>([])
  const [listing, setListing] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const off = window.termsprawl.relay.onFrame((frame) => {
      const parsed = parseRelayTermFrame(frame.text)
      if (parsed && parsed.k === 'term-list') setTerms(parsed.terms)
    })
    return () => off()
  }, [])

  const list = (): void => {
    if (listing) return
    setListing(true)
    setNote(null)
    void window.termsprawl.relay
      .sendFrame(JSON.stringify({ v: 1, k: 'list' } satisfies RelayTermFrame))
      .then((res) => {
        setListing(false)
        if (!res.ok) setNote(res.error ?? 'could not list host terminals')
      })
      .catch(() => {
        setListing(false)
        setNote('could not list host terminals')
      })
  }

  const open = (term: { id: string; title: string }): void => {
    // Spawn through the same one-shot store the settings panel uses for
    // agent-login nodes: Canvas adds a remote terminal node to the active
    // project on its next render. The settings sheet stays open behind it.
    useCanvasRequests.getState().spawn({ kind: 'relayTerm', term: term.id, title: term.title })
    setNote(`opened ${term.title || term.id} from the host`)
  }

  return (
    <Card
      title="Remote terminals"
      sub="terminals the trusted host is currently serving"
    >
      <div className="flex justify-end gap-2">
        <Button disabled={listing} onClick={list}>
          {listing ? 'Listing…' : 'List host terminals'}
        </Button>
      </div>
      {note && <Hint className="text-danger">{note}</Hint>}
      {terms.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 border-b border-edge py-1.5 last:border-b-0">
              <span className="truncate font-mono text-xs text-ink" title={t.id}>
                {t.title || t.id}
              </span>
              <Button variant="primary" onClick={() => open(t)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Chat models (Phase 11 Task 11.4). Default provider/model for new chats +
 * per-provider API keys. Keys are stored in settings.json on this machine
 * only (env TERMSPRAWL_PROVIDER_KEY_<ID> overrides per provider) — never
 * committed, never written into project files. */
function ChatSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  const chat = settings.chat ?? {}
  const providers: ApiProviderConfig[] = settings.apiProviders ?? []
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const keyFor = (id: string): string => chat.keys?.find((k: { providerId: string }) => k.providerId === id)?.key ?? ''
  const envName = (id: string): string => `TERMSPRAWL_PROVIDER_KEY_${id.toUpperCase()}`

  const saveChat = (patch: Partial<NonNullable<typeof settings.chat>>): void => {
    void update({ chat: { ...chat, ...patch } })
  }

  const saveKey = (providerId: string, value: string): void => {
    const keys = (chat.keys ?? []).filter((k: { providerId: string }) => k.providerId !== providerId)
    if (value.trim()) keys.push({ providerId, key: value.trim() })
    saveChat({ keys })
  }

  return (
    <>
      <Hint>
        Chat nodes talk to an OpenAI-compatible or Anthropic endpoint. Add a provider under
        API providers, then paste its key below. Keys are stored on this machine only —
        never committed (the {providers.length > 0 ? envName(providers[0].id) : 'TERMSPRAWL_PROVIDER_KEY_<ID>'} env var overrides a stored key).
      </Hint>

      <PrefRow
        label="Default provider"
        sub="which configured provider new chat nodes use"
      >
        <Select
          className="w-[200px]"
          selectClassName="w-full"
          value={chat.defaultProvider ?? ''}
          onChange={(e) => void saveChat({ defaultProvider: e.target.value || undefined })}
        >
          <option value="">first configured</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </Select>
      </PrefRow>

      <PrefRow
        label="Default model"
        sub="e.g. gpt-4o-mini, claude-sonnet-4-5, llama3 — /model overrides per chat"
      >
        <TextInput
          placeholder="model id"
          spellCheck={false}
          value={chat.defaultModel ?? ''}
          onChange={(e) => void saveChat({ defaultModel: e.target.value || undefined })}
        />
      </PrefRow>

      {providers.length === 0 ? (
        <Hint>No providers configured yet — add one under “API providers” above.</Hint>
      ) : (
        providers.map((p) => {
          const stored = keyFor(p.id)
          const draft = drafts[p.id] ?? ''
          return (
            <PrefRow
              key={p.id}
              label={`${p.name || p.id} API key`}
              sub={stored ? `a key is set (…${stored.slice(-4)})` : `no key — or set ${envName(p.id)}`}
            >
              <TextInput
                type="password"
                placeholder={stored ? '••••••••' : 'sk-…'}
                spellCheck={false}
                value={draft}
                onChange={(e) => setDrafts((d: Record<string, string>) => ({ ...d, [p.id]: e.target.value }))}
                onBlur={() => {
                  if (draft.trim() && draft !== stored) saveKey(p.id, draft)
                }}
              />
            </PrefRow>
          )
        })
      )}
    </>
  )
}
