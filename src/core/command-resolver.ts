// Command resolution for terminal presets (e.g. the druk editor node).
//
// GUI-launched apps (AppImage from a desktop launcher) inherit a minimal PATH
// that omits user install dirs like ~/.druk/bin. Spawning `shell -lc druk`
// then fails with "command not found" — a login+command shell does NOT source
// .zshrc, where the user's PATH export lives. We resolve the first token to
// an absolute path before spawning so the preset works regardless of how the
// app was launched.

import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * Legacy command-name aliases: some CLIs renamed but the registry (and
 * persisted project files) keep the old spawn name. `gemini` → Antigravity,
 * which ships as `agy` (and `antigravity`) on modern installs; the space
 * image carries a `gemini` shim, the desktop doesn't.
 */
const COMMAND_ALIASES: Record<string, string[]> = {
  gemini: ['agy', 'antigravity']
}

let managedBin: string | undefined
export function setManagedBin(path: string): void { managedBin = path }
export function executableFile(path: string): boolean {
  try { accessSync(path, constants.X_OK); return statSync(path).isFile() } catch { return false }
}

export function commandCandidates(name: string, home: string = homedir()): string[] {
  if (isAbsolute(name)) return [name]
  const pathEnv = process.env.PATH ?? ''
  const userDirs = ['.local/bin', '.druk/bin', '.opencode/bin', '.grok/bin', 'bin']
  const dirs = [...pathEnv.split(':').filter(Boolean), ...userDirs.map(sub => join(home, sub)), ...(managedBin ? [managedBin] : [])]
  return [name, ...(COMMAND_ALIASES[name] ?? [])].flatMap(command => dirs.map(dir => join(dir, command)))
}

/**
 * Resolve a command name to an absolute path. Checks, in order:
 *   1. already-absolute input → returned as-is
 *   2. each dir on $PATH
 *   3. known user-local install locations (~/.local/bin for agent CLIs,
 *      ~/.druk/bin for the druk TUI, ~/bin) — GUI apps won't see these on a
 *      minimal PATH)
 *   4. legacy aliases of the name (COMMAND_ALIASES)
 * Returns null when nothing matches.
 */
export function findExecutable(name: string, home: string = homedir()): string | null {
  return commandCandidates(name, home).find(executableFile) ?? null
}

/**
 * A user-facing notice when a preset command's first token cannot be resolved
 * to an executable anywhere (PATH + user install dirs + aliases). The PTY
 * still shows the shell's own "command not found" and exits; this tells the
 * user the reason and the fix. Null when resolvable or already absolute.
 */
export function unresolvedNotice(line: string, home: string = homedir()): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const space = trimmed.indexOf(' ')
  const name = space === -1 ? trimmed : trimmed.slice(0, space)
  if (findExecutable(name, home)) return null
  return `termsprawl: '${name}' not found — install it, or add its bin dir to PATH (GUI launches check ~/.local/bin). Close and reopen this node once it's available.`
}

/**
 * The line to exec in place of a missing preset command. Written raw into an
 * INTERACTIVE shell, the notice text would be parsed by the line editor
 * (unmatched quotes → `quote>` prompts, echoed garbage). Instead we exec a
 * non-interactive /bin/sh that prints the notice and exits cleanly — the
 * message is the whole story, no shell mangling.
 */
export function missingCommandExec(notice: string): string {
  const script = `printf '%s\\n' ${JSON.stringify(notice)}; exit 1`
  return `exec /bin/sh -c ${JSON.stringify(script)}`
}

/**
 * Resolve the first token of a command line (e.g. `druk` in `druk --dir x`)
 * to an absolute path, keeping any trailing arguments intact. When nothing
 * resolves, the original line is returned so the shell can report the error.
 */
export function resolveCommandLine(line: string, home: string = homedir()): string {
  const trimmed = line.trim()
  const space = trimmed.indexOf(' ')
  const name = space === -1 ? trimmed : trimmed.slice(0, space)
  const rest = space === -1 ? '' : trimmed.slice(space)

  const resolved = findExecutable(name, home)
  if (!resolved) return line
  return `${resolved}${rest}`
}
