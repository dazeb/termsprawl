// CLI behavior probes (Phase 7, Task 7.6). Electron-free, TDD'd against a fake
// `claude --help` fixture — never a live binary.

/** Whether the installed Claude CLI supports `--permission-mode` (from its own
 * `--help` text). Older CLIs omit it; when unsupported the UI hides the control
 * and we don't append the flag. */
export function claudeSupportsPermissionMode(helpText: string): boolean {
  return helpText.includes('--permission-mode')
}

/** The login args for a fresh managed account, inferred from `claude --help`.
 * Returns `['auth', 'login']` when that subcommand exists, `/login` (the slash
 * command) when mentioned, and `[]` when neither is advertised (fall back to a
 * bare `claude` terminal and let the user sign in interactively). */
export function claudeLoginArgs(helpText: string): string[] {
  if (/auth\s+login/.test(helpText)) return ['auth', 'login']
  if (/\/login/.test(helpText)) return ['/login']
  return []
}

/** Build the full claude invocation for a managed-account login node. */
export function claudeLoginCommand(helpText: string): string {
  const args = claudeLoginArgs(helpText)
  return args.length > 0 ? `claude ${args.join(' ')}` : 'claude'
}
