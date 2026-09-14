import { readFileSync } from 'node:fs'
import type { SettingsHook } from '../shared/types'
export interface HookFile { path: string; agent: string; source?: 'managed' | 'legacy' }
const secret = /([?&](?:key|token|secret|api_key|password)=)[^&\s"']+/gi
export function redactHookSecret(s: string): string { return s.replace(secret, '$1[redacted]').replace(/\b(?:sk|ghp)_[A-Za-z0-9_-]+\b/g, '[redacted]') }
export function parseHookText(raw: string, agent: string, source?: 'managed' | 'legacy'): SettingsHook[] {
  const out: SettingsHook[] = []; const managed = source ?? (/__termsprawl(?:Managed)?/.test(raw) ? 'managed' : 'legacy'); let event: string | undefined
  try { const parsed = JSON.parse(raw) as Record<string, unknown>; for (const [name, value] of Object.entries(parsed)) if (Array.isArray(value)) for (const entry of value) { const hooks = (entry as any)?.hooks; for (const hook of Array.isArray(hooks) ? hooks : []) { const command = hook?.url ?? hook?.command; if (typeof command === 'string') out.push({ id: `${agent}:${name}:${out.length}`, event:name, agent, source:managed, command:redactHookSecret(command), enabled:true }) } } } catch { /* TOML fallback */ }
  if (out.length) return out
  for (const line of raw.split(/\r?\n/)) { const em = line.match(/(?:PreToolUse|PostToolUse|Notification|Stop|UserPromptSubmit|PermissionRequest|SubagentStop|SessionStart|SessionEnd|SubagentStart|PreCompact|PostCompact)/); if (em) event = em[0]; const cm = line.match(/(?:command|url)\s*=\s*["']([^"']+)/); if (event && cm) { out.push({ id:`${agent}:${event}:${out.length}`,event,agent,source:managed,command:redactHookSecret(cm[1]),enabled:true }); event=undefined } }
  return out
}
export function inventoryHooks(files: HookFile[]): SettingsHook[] { return files.flatMap(f => { try { return parseHookText(readFileSync(f.path, 'utf8'), f.agent, f.source) } catch { return [] } }).sort((a,b) => a.id.localeCompare(b.id)) }
