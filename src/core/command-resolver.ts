// Command resolution for terminal presets (e.g. the druk editor node).
//
// GUI-launched apps (AppImage from a desktop launcher) inherit a minimal PATH
// that omits user install dirs like ~/.druk/bin. Spawning `shell -lc druk`
// then fails with "command not found" — a login+command shell does NOT source
// .zshrc, where the user's PATH export lives. We resolve the first token to
// an absolute path before spawning so the preset works regardless of how the
// app was launched.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * Resolve a command name to an absolute path. Checks, in order:
 *   1. already-absolute input → returned as-is
 *   2. each dir on $PATH
 *   3. known user-local install locations (~/.local/bin for agent CLIs,
 *      ~/.druk/bin for the druk TUI, ~/bin) — GUI apps won't see these on a
 *      minimal PATH)
 * Returns null when nothing matches.
 */
export function findExecutable(name: string, home: string = homedir()): string | null {
  if (isAbsolute(name)) return name

  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }

  const userDirs = ['.local/bin', '.druk/bin', 'bin']
  for (const sub of userDirs) {
    const candidate = join(home, sub, name)
    if (existsSync(candidate)) return candidate
  }

  return null
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
