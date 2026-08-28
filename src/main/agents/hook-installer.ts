// Claude Code hook installer — re-exports from core (the electron-free logic),
// keeping the same import surface for main/index.ts.
// The real implementation lives at src/core/hook-installer.ts.
export {
  buildClaudeHookConfig,
  installClaudeHooks,
  uninstallClaudeHooks,
  claudeSettingsPath
} from '../../core/hook-installer'
