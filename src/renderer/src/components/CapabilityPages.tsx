// Capability pages: Skills, Hooks, Commands, MCP Servers (read from the agent
// CLIs' own config trees) and Usage.
//
// These are the pages that answer "what can my agents do on this machine?".
// Every row carries the agent it belongs to — that chip is the one thing a
// multi-agent surface can show that a single-agent settings page cannot — and
// the only write anywhere here is the skill toggle, which moves a folder
// between the scanned and the parked directory (see core/settings-skills.ts).
import { useEffect, useMemo, useState } from 'react'
import type { SettingsCapabilities, UsageStats } from '@shared/types'
import { Button, Card, Hint, Status, TextInput, Toggle } from './ui/kit'

/* ── shared bits ─────────────────────────────────────────────────────────── */

const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  termsprawl: 'Termsprawl'
}
const agentLabel = (agent: string): string => AGENT_LABEL[agent] ?? agent

/** Which agent a row belongs to, as a chip. Reads as provenance, not status. */
function AgentChip({ agent }: { agent: string }): React.JSX.Element {
  const mark = agent === 'claude' ? '✳' : agent === 'codex' ? '›' : '◆'
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-edge px-2 py-[3px] text-[11px] leading-none text-mute">
      <span aria-hidden="true" className="text-[10px]">
        {mark}
      </span>
      {agentLabel(agent)}
    </span>
  )
}

/** One capability row: mark, name, one line of description, chip, control. */
function CapabilityRow({
  name,
  description,
  chip,
  control,
  muted = false
}: {
  name: string
  description: string
  chip?: React.ReactNode
  control?: React.ReactNode
  muted?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-edge py-3 last:border-b-0">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-edge bg-raised text-[13px] text-mute"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className={`min-w-0 flex-1 ${muted ? 'opacity-60' : ''}`}>
        <div className="truncate font-mono text-[13px] font-medium leading-tight text-ink" title={name}>
          {name}
        </div>
        <div className="mt-1 truncate text-[12px] leading-snug text-mute" title={description}>
          {description || 'No description provided.'}
        </div>
      </div>
      {chip}
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  )
}

/** A titled card of rows, with the count next to the title. */
function CapabilityGroup({
  title,
  count,
  children
}: {
  title: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-[13px] font-medium leading-none text-ink">{title}</h2>
        <span className="text-[12px] leading-none text-mute tabular-nums">{count}</span>
      </div>
      <div className="overflow-hidden rounded-[10px] border border-edge bg-panel px-4">{children}</div>
    </section>
  )
}

/** The dashed "nothing here" card. One real action, never a decorative one. */
function EmptyGroup({
  title,
  body,
  action
}: {
  title: string
  body: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-edge px-6 py-8 text-center">
      <div className="text-[13px] font-medium text-ink">{title}</div>
      <p className="max-w-[46ch] text-[12px] leading-snug text-mute [text-wrap:pretty]">{body}</p>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}

/** Scope filter + search + a real refresh, the toolbar every page shares. */
function Toolbar({
  scopes,
  scope,
  onScope,
  query,
  onQuery,
  placeholder,
  onRefresh,
  extra
}: {
  scopes: { id: string; label: string; count: number }[]
  scope: string
  onScope: (id: string) => void
  query: string
  onQuery: (value: string) => void
  placeholder: string
  onRefresh: () => void
  extra?: React.ReactNode
}): React.JSX.Element {
  return (
    // Wraps rather than clipping: marketplace and agent names are user data,
    // and a long one used to push the Refresh button off the edge.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label="Scope">
        {scopes.map((s) => {
          const active = s.id === scope
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onScope(s.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
                active ? 'border border-edge bg-raised text-ink' : 'border border-transparent text-mute hover:text-ink'
              }`}
            >
              {s.label}
              <span className="tabular-nums opacity-70">{s.count}</span>
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <TextInput
          className="w-[200px]"
          placeholder={placeholder}
          spellCheck={false}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label={placeholder}
        />
        <Button onClick={onRefresh} title="Re-read the agent config trees">
          Refresh
        </Button>
        {extra}
      </div>
    </div>
  )
}

/** The shared data seam: one fetch of the capabilities snapshot, plus the two
 * writes (skill toggle, hook repair), each of which returns a fresh snapshot so
 * the panel never keeps a stale list after a mutation. */
function useCapabilities(): {
  data: SettingsCapabilities | null
  error: string | null
  busy: string | null
  reload: () => void
  toggleSkill: (id: string, enabled: boolean) => void
  togglePlugin: (id: string, enabled: boolean) => void
  reinstallHooks: (agent: string) => void
} {
  const [data, setData] = useState<SettingsCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const run = (key: string, work: () => Promise<SettingsCapabilities>): void => {
    setBusy(key)
    setError(null)
    void work()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null))
  }

  const reload = (): void => run('reload', () => window.termsprawl.settings.capabilities())
  useEffect(reload, [])

  return {
    data,
    error,
    busy,
    reload,
    toggleSkill: (id, enabled) => run(`skill:${id}`, () => window.termsprawl.settings.setSkillEnabled(id, enabled)),
    togglePlugin: (id, enabled) => run(`plugin:${id}`, () => window.termsprawl.settings.setPluginEnabled(id, enabled)),
    reinstallHooks: (agent) => run(`hooks:${agent}`, () => window.termsprawl.settings.reinstallHooks(agent))
  }
}

/** A small bordered chip — provenance, version, transport, tool count. */
function Chip({ children, mono = false }: { children: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border border-edge px-2 py-[3px] text-[11px] leading-none text-mute ${
        mono ? 'font-mono tabular-nums' : ''
      }`}
    >
      {children}
    </span>
  )
}

const matches = (query: string, ...fields: string[]): boolean => {
  const q = query.trim().toLowerCase()
  return !q || fields.some((f) => f.toLowerCase().includes(q))
}

/** Scope options derived from what is actually installed. */
function scopeOptions(agents: string[], counts: Map<string, number>): { id: string; label: string; count: number }[] {
  const unique = [...new Set(agents)].sort()
  const total = [...counts.values()].reduce((n, c) => n + c, 0)
  return [
    { id: 'all', label: 'All agents', count: total },
    ...unique.map((a) => ({ id: a, label: agentLabel(a), count: counts.get(a) ?? 0 }))
  ]
}

/* ── Skills ──────────────────────────────────────────────────────────────── */

export function SkillsPage(): React.JSX.Element {
  const { data, error, busy, reload, toggleSkill } = useCapabilities()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')

  const skills = data?.skills ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of skills) map.set(s.agent, (map.get(s.agent) ?? 0) + 1)
    return map
  }, [skills])
  const visible = skills.filter((s) => (scope === 'all' || s.agent === scope) && matches(query, s.name, s.description))
  const enabled = visible.filter((s) => s.enabled)
  const disabled = visible.filter((s) => !s.enabled)

  if (error) return <ErrorCard error={error} onRetry={reload} />
  if (!data) return <LoadingCard />
  if (!data.supported) return <UnavailableCard reason={data.reason} />

  return (
    <>
      <Toolbar
        scopes={scopeOptions(skills.map((s) => s.agent), counts)}
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="Search skills…"
        onRefresh={reload}
      />
      <CapabilityGroup title="Enabled" count={enabled.length}>
        {enabled.length === 0 ? (
          <div className="py-1">
            <EmptyGroup
              title={skills.length === 0 ? 'No skills installed' : 'No enabled skills match'}
              body="Skills are folders with a SKILL.md inside the agent CLI's own skills directory (~/.claude/skills, ~/.codex/skills). termsprawl lists them; the CLI loads them."
            />
          </div>
        ) : (
          enabled.map((s) => (
            <CapabilityRow
              key={s.id}
              name={s.name}
              description={s.description}
              chip={<AgentChip agent={s.agent} />}
              control={
                <Toggle
                  checked
                  disabled={busy === `skill:${s.id}`}
                  ariaLabel={`Disable ${s.name}`}
                  title="Move this skill into skills-disabled/ so the CLI stops loading it"
                  onChange={(next) => toggleSkill(s.id, next)}
                />
              }
            />
          ))
        )}
      </CapabilityGroup>
      {disabled.length > 0 && (
        <CapabilityGroup title="Disabled" count={disabled.length}>
          {disabled.map((s) => (
            <CapabilityRow
              key={s.id}
              muted
              name={s.name}
              description={s.description}
              chip={<AgentChip agent={s.agent} />}
              control={
                <Toggle
                  checked={false}
                  disabled={busy === `skill:${s.id}`}
                  ariaLabel={`Enable ${s.name}`}
                  title="Move this skill back into the agent's skills directory"
                  onChange={(next) => toggleSkill(s.id, next)}
                />
              }
            />
          ))}
        </CapabilityGroup>
      )}
      <Hint>
        Disabling moves the folder to a sibling <code>skills-disabled/</code> the CLI never scans. Nothing is
        deleted, and enabling copies it straight back.
      </Hint>
    </>
  )
}

/* ── Hooks ───────────────────────────────────────────────────────────────── */

export function HooksPage(): React.JSX.Element {
  const { data, error, busy, reload, reinstallHooks } = useCapabilities()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')

  const hooks = data?.hooks ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const h of hooks) map.set(h.agent, (map.get(h.agent) ?? 0) + 1)
    return map
  }, [hooks])
  const visible = hooks.filter((h) => (scope === 'all' || h.agent === scope) && matches(query, h.command, h.event))
  const agents = scope === 'all' ? [...new Set(hooks.map((h) => h.agent))].sort() : [scope]

  if (error) return <ErrorCard error={error} onRetry={reload} />
  if (!data) return <LoadingCard />
  if (!data.supported) return <UnavailableCard reason={data.reason} />

  return (
    <>
      <Toolbar
        scopes={scopeOptions(hooks.map((h) => h.agent), counts)}
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="Search hooks…"
        onRefresh={reload}
        extra={
          agents.length > 0 ? (
            <Button
              variant="primary"
              disabled={busy?.startsWith('hooks:') === true}
              onClick={() => {
                for (const agent of agents) reinstallHooks(agent)
              }}
              title="Re-run termsprawl's hook installer for the agents in scope (idempotent)"
            >
              {busy?.startsWith('hooks:') ? 'Repairing…' : 'Repair hooks'}
            </Button>
          ) : undefined
        }
      />
      <CapabilityGroup title="Managed by termsprawl" count={visible.filter((h) => h.source === 'managed').length}>
        {visible.filter((h) => h.source === 'managed').length === 0 ? (
          <div className="py-1">
            <EmptyGroup
              title="No managed hooks"
              body="termsprawl writes a hook into each agent CLI's config so node status badges can update. Repair hooks installs them again if the config was edited or reset."
            />
          </div>
        ) : (
          visible
            .filter((h) => h.source === 'managed')
            .map((h) => (
              <CapabilityRow
                key={h.id}
                name={h.event}
                description={h.command}
                chip={<AgentChip agent={h.agent} />}
              />
            ))
        )}
      </CapabilityGroup>
      {visible.some((h) => h.source === 'legacy') && (
        <CapabilityGroup title="Not managed by termsprawl" count={visible.filter((h) => h.source === 'legacy').length}>
          {visible
            .filter((h) => h.source === 'legacy')
            .map((h) => (
              <CapabilityRow
                key={h.id}
                muted
                name={h.event}
                description={h.command}
                chip={<AgentChip agent={h.agent} />}
              />
            ))}
        </CapabilityGroup>
      )}
      <Hint>
        These entries live in the agent CLIs' own config files. termsprawl reports them and installs its own; it
        never removes another tool's hooks.
      </Hint>
    </>
  )
}

/* ── Commands ────────────────────────────────────────────────────────────── */

export function CommandsPage(): React.JSX.Element {
  const { data, error, reload } = useCapabilities()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')

  const commands = data?.commands ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of commands) map.set(c.source, (map.get(c.source) ?? 0) + 1)
    return map
  }, [commands])
  const visible = commands.filter((c) => (scope === 'all' || c.source === scope) && matches(query, c.name, c.description))
  const sources = scope === 'all' ? [...new Set(commands.map((c) => c.source))].sort() : [scope]

  if (error) return <ErrorCard error={error} onRetry={reload} />
  if (!data) return <LoadingCard />
  if (!data.supported) return <UnavailableCard reason={data.reason} />

  return (
    <>
      <Toolbar
        scopes={[
          { id: 'all', label: 'All', count: commands.length },
          ...sources.map((s) => ({ id: s, label: s === 'built-in' ? 'Built-in' : agentLabel(s), count: counts.get(s) ?? 0 }))
        ]}
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="Search commands…"
        onRefresh={reload}
      />
      {sources.map((source) => {
        const rows = visible.filter((c) => c.source === source)
        return (
          <CapabilityGroup
            key={source}
            title={source === 'built-in' ? 'Built-in commands' : agentLabel(source)}
            count={rows.length}
          >
            {rows.length === 0 ? (
              <div className="py-1">
                <EmptyGroup title="No commands match" body="Clear the search to see every command the chat node understands." />
              </div>
            ) : (
              rows.map((c) => (
                <CapabilityRow
                  key={c.name}
                  name={c.name}
                  description={c.description}
                  chip={<Status>{c.available ? 'available' : 'unavailable'}</Status>}
                />
              ))
            )}
          </CapabilityGroup>
        )
      })}
      <Hint>
        The parser is the source of truth: a command listed here is one the chat node will actually intercept.
      </Hint>
    </>
  )
}

/* ── MCP servers ─────────────────────────────────────────────────────────── */

export function McpServersPage(): React.JSX.Element {
  const { data, error, reload } = useCapabilities()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')

  const servers = data?.mcp ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of servers) map.set(s.agent, (map.get(s.agent) ?? 0) + 1)
    return map
  }, [servers])
  const visible = servers.filter((s) => (scope === 'all' || s.agent === scope) && matches(query, s.name, s.detail))
  const agents = scope === 'all' ? [...new Set(servers.map((s) => s.agent))].sort() : [scope]

  if (error) return <ErrorCard error={error} onRetry={reload} />
  if (!data) return <LoadingCard />
  if (!data.supported) return <UnavailableCard reason={data.reason} />

  return (
    <>
      <Toolbar
        scopes={scopeOptions(servers.map((s) => s.agent), counts)}
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="Search MCP servers…"
        onRefresh={reload}
      />
      {agents.length === 0 ? (
        <EmptyGroup
          title="No MCP servers declared"
          body="MCP servers are declared in each agent CLI's own config (~/.claude.json, ~/.codex/config.toml). Add one there and it appears here with the command that will launch it."
        />
      ) : (
        agents.map((agent) => {
          const rows = visible.filter((s) => s.agent === agent)
          return (
            <CapabilityGroup key={agent} title={agentLabel(agent)} count={rows.length}>
              {rows.length === 0 ? (
                <div className="py-1">
                  <EmptyGroup title="Nothing matches" body="Clear the search to see every server declared for this agent." />
                </div>
              ) : (
                rows.map((s) => (
                  <CapabilityRow
                    key={s.id}
                    name={s.name}
                    description={s.detail}
                    chip={<Chip mono>{s.transport}</Chip>}
                  />
                ))
              )}
            </CapabilityGroup>
          )
        })
      )}
      <Hint>
        Read-only: termsprawl reports the MCP servers your agent CLIs will start. Edit them in the CLI's own
        config file so nothing is out of sync with what actually launches.
      </Hint>
    </>
  )
}

/* ── Plugins ─────────────────────────────────────────────────────────────── */

/** Cached plugin bundles.
 *
 * "Installed" is the CLI's own plugin cache — a real inventory — and the
 * toggle edits the CLI's `[plugins."name@marketplace"] enabled` key, which is
 * the same flag the CLI reads. Nothing else in that config is touched. */
export function PluginsPage(): React.JSX.Element {
  const { data, error, busy, reload, togglePlugin } = useCapabilities()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')

  const plugins = data?.plugins ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of plugins) map.set(p.marketplace, (map.get(p.marketplace) ?? 0) + 1)
    return map
  }, [plugins])
  const visible = plugins.filter(
    (p) => (scope === 'all' || p.marketplace === scope) && matches(query, p.name, p.description, p.marketplace)
  )
  const marketplaces = [...new Set(visible.map((p) => p.marketplace))].sort()

  if (error) return <ErrorCard error={error} onRetry={reload} />
  if (!data) return <LoadingCard />
  if (!data.supported) return <UnavailableCard reason={data.reason} />

  return (
    <>
      <Toolbar
        scopes={[
          { id: 'all', label: 'All marketplaces', count: plugins.length },
          ...[...counts.keys()].sort().map((m) => ({ id: m, label: m, count: counts.get(m) ?? 0 }))
        ]}
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="Search plugins…"
        onRefresh={reload}
      />
      {visible.length === 0 ? (
        <EmptyGroup
          title="No plugins installed"
          body="Plugins arrive from a CLI's own marketplace and land in its plugin cache. Install one with the CLI and it appears here with whatever it ships."
        />
      ) : (
        marketplaces.map((marketplace) => {
          const rows = visible.filter((p) => p.marketplace === marketplace)
          return (
            <CapabilityGroup key={marketplace} title={marketplace} count={rows.length}>
              {rows.map((p) => (
                <CapabilityRow
                  key={p.id}
                  name={p.name}
                  description={p.description}
                  chip={
                    <>
                      {p.version && <Chip mono>{p.version}</Chip>}
                      <Chip>
                        {p.skills} {p.skills === 1 ? 'skill' : 'skills'}
                        {p.agents > 0 ? ` · ${p.agents} ${p.agents === 1 ? 'agent' : 'agents'}` : ''}
                      </Chip>
                    </>
                  }
                  control={
                    <Toggle
                      checked={p.enabled}
                      disabled={busy === `plugin:${p.id}`}
                      ariaLabel={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`}
                      title={`Writes enabled = ${p.enabled ? 'false' : 'true'} for ${p.name}@${p.marketplace} in the CLI config`}
                      onChange={(next) => togglePlugin(p.id, next)}
                    />
                  }
                />
              ))}
            </CapabilityGroup>
          )
        })
      )}
      <Hint>
        The toggle writes the CLI's own <code>enabled</code> flag for that plugin and nothing else. A plugin cached
        but never enabled shows as off.
      </Hint>
    </>
  )
}

/* ── Subagents ───────────────────────────────────────────────────────────── */

/** Reusable subagent definitions the CLIs load from their own config.
 *
 * Read-only: the model and tool grants a subagent runs with belong to the CLI
 * that owns the file, so the row reports them instead of offering a picker
 * that would not mean anything. */
export function SubagentsPage(): React.JSX.Element {
  const { data, error, reload } = useCapabilities()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')

  const agents = data?.subagents ?? []
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of agents) map.set(a.agent, (map.get(a.agent) ?? 0) + 1)
    return map
  }, [agents])
  const visible = agents.filter((a) => (scope === 'all' || a.agent === scope) && matches(query, a.name, a.description))
  const groups = [...new Set(visible.map((a) => a.agent))].sort()

  if (error) return <ErrorCard error={error} onRetry={reload} />
  if (!data) return <LoadingCard />
  if (!data.supported) return <UnavailableCard reason={data.reason} />

  return (
    <>
      <Toolbar
        scopes={scopeOptions(agents.map((a) => a.agent), counts)}
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="Search subagents…"
        onRefresh={reload}
      />
      {groups.length === 0 ? (
        <EmptyGroup
          title="No subagents defined"
          body="A subagent is a file in the CLI's own agents directory (~/.claude/agents, ~/.codex/agents) that declares what it may do. Add one there and it shows up here."
        />
      ) : (
        groups.map((agent) => {
          const rows = visible.filter((a) => a.agent === agent)
          return (
            <CapabilityGroup key={agent} title={agentLabel(agent)} count={rows.length}>
              {rows.map((a) => (
                <CapabilityRow
                  key={a.id}
                  name={a.name}
                  description={a.description}
                  chip={
                    <>
                      <Chip>{a.tools === 0 ? 'All tools' : `${a.tools} ${a.tools === 1 ? 'tool' : 'tools'}`}</Chip>
                      {a.detail && <Chip mono>{a.detail}</Chip>}
                    </>
                  }
                />
              ))}
            </CapabilityGroup>
          )
        })
      )}
      <Hint>
        Subagents come from the agent's own config tree. The model and permissions stay with the CLI, so this page
        reports them rather than offering controls that wouldn't reach it.
      </Hint>
    </>
  )
}

/* ── Usage ───────────────────────────────────────────────────────────────── */

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

const minutes = (seconds: number): string => (seconds >= 60 ? `${Math.round(seconds / 60)} m` : `${Math.round(seconds)} s`)

/** Metric strip: five numbers, no decoration, tabular figures. */
function MetricStrip({ stats }: { stats: UsageStats }): React.JSX.Element {
  const peak = stats.daily.reduce((max, d) => Math.max(max, d.inputTokens + d.outputTokens), 0)
  // Streaks count consecutive days present in the daily series, newest first.
  const days = [...stats.daily].sort((a, b) => a.date.localeCompare(b.date))
  let longest = 0
  let current = 0
  for (const day of days) {
    const active = day.inputTokens + day.outputTokens > 0
    current = active ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  const metrics = [
    { label: 'Total tokens', value: compact(stats.totalInputTokens + stats.totalOutputTokens) },
    { label: 'Peak tokens', value: compact(peak) },
    { label: 'Longest session', value: minutes(stats.longestSessionSeconds) },
    { label: 'Current streak', value: `${current} d` },
    { label: 'Longest streak', value: `${longest} d` }
  ]
  return (
    <div className="grid grid-cols-5 gap-px overflow-hidden rounded-[10px] border border-edge bg-edge">
      {metrics.map((m) => (
        <div key={m.label} className="flex flex-col items-center gap-1 bg-panel px-3 py-4">
          <div className="font-mono text-[15px] font-medium tabular-nums text-ink">{m.value}</div>
          <div className="text-[11px] leading-none text-mute">{m.label}</div>
        </div>
      ))}
    </div>
  )
}

/** Token activity grid: one square per day, newest at the right. Intensity is
 * opacity on a single accent — five steps, no legend needed at this size. */
function ActivityGrid({ daily }: { daily: UsageStats['daily'] }): React.JSX.Element {
  const days = [...daily].sort((a, b) => a.date.localeCompare(b.date)).slice(-182)
  const peak = days.reduce((max, d) => Math.max(max, d.inputTokens + d.outputTokens), 0)
  return (
    <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${days.length} days of token activity`}>
      {days.map((d) => {
        const total = d.inputTokens + d.outputTokens
        const step = peak === 0 || total === 0 ? 0 : Math.ceil((total / peak) * 4)
        const opacity = [0, 0.25, 0.45, 0.7, 1][step]
        return (
          <span
            key={d.date}
            title={`${d.date}: ${total.toLocaleString()} tokens`}
            className="h-[10px] w-[10px] rounded-[2px] border border-edge"
            style={opacity === 0 ? undefined : { backgroundColor: `color-mix(in oklab, var(--fg) ${opacity * 100}%, transparent)`, borderColor: 'transparent' }}
          />
        )
      })}
    </div>
  )
}

export function UsagePage(): React.JSX.Element {
  const [data, setData] = useState<UsageStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<'7' | '30'>('7')

  const load = (): void => {
    setError(null)
    void window.termsprawl.settings
      .usage()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [])

  if (error) return <ErrorCard error={error} onRetry={load} />
  if (!data) return <LoadingCard />
  if (!data.supported || !data.hasData) {
    return (
      <EmptyGroup
        title={data.supported ? 'No usage recorded yet' : 'Usage collection is not available'}
        body={
          data.reason ??
          'Chat nodes report token counts and cost per reply; this page totals them once a conversation has run.'
        }
        action={<Button onClick={load}>Check again</Button>}
      />
    )
  }

  const days = data.daily.slice(-Number(range))
  const peak = Math.max(1, ...days.map((d) => d.inputTokens + d.outputTokens))

  return (
    <>
      <MetricStrip stats={data} />
      <CapabilityGroup title="Token activity" count={data.daily.length}>
        <div className="py-3">
          <ActivityGrid daily={data.daily} />
        </div>
      </CapabilityGroup>
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 px-0.5">
          <h2 className="text-[13px] font-medium leading-none text-ink">Daily trend</h2>
          <div className="ml-auto flex items-center gap-1">
            {(['7', '30'] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={`rounded-[7px] px-2.5 py-1.5 text-[12px] leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
                  range === r ? 'border border-edge bg-raised text-ink' : 'border border-transparent text-mute hover:text-ink'
                }`}
              >
                Last {r} days
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-edge bg-panel px-4 py-4">
          <div className="flex h-[120px] items-end gap-1">
            {days.map((d) => {
              const total = d.inputTokens + d.outputTokens
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${total.toLocaleString()} tokens`}
                  className="flex-1 rounded-t-[2px] bg-ink"
                  style={{ height: `${Math.max(2, (total / peak) * 100)}%`, opacity: total === 0 ? 0.15 : 1 }}
                />
              )
            })}
          </div>
        </div>
      </section>
      <CapabilityGroup title="Model usage" count={data.models.length}>
        {data.models.map((m) => (
          <CapabilityRow
            key={`${m.provider}:${m.model}`}
            name={`${m.provider} / ${m.model}`}
            description={`${compact(m.inputTokens)} in · ${compact(m.outputTokens)} out`}
            chip={<Status>${m.cost.toFixed(2)}</Status>}
          />
        ))}
      </CapabilityGroup>
    </>
  )
}

/* ── shared states ───────────────────────────────────────────────────────── */

function LoadingCard(): React.JSX.Element {
  return (
    <Card>
      <Status>Reading the agent config trees…</Status>
    </Card>
  )
}

function ErrorCard({ error, onRetry }: { error: string; onRetry: () => void }): React.JSX.Element {
  return (
    <Card>
      <Status className="text-danger">{error}</Status>
      <div className="mt-2">
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </Card>
  )
}

function UnavailableCard({ reason }: { reason?: string }): React.JSX.Element {
  return (
    <EmptyGroup
      title="Not available here"
      body={reason ?? 'Capability discovery runs on the machine that owns the agent config, so it is desktop-only.'}
    />
  )
}
