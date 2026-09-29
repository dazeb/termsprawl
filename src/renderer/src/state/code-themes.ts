// Code themes in the renderer: registers each shared palette as a Monaco
// theme and keeps the module-level store canvas nodes read. Nodes only
// receive NodeProps, so the active theme rides a zustand store instead of
// prop drilling (same pattern as browser-home.ts). The settings panel
// previews are rendered straight from the same shared palettes.

import { create } from 'zustand'
import { monaco } from '../monaco'
import {
  CODE_THEMES,
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  type CodeThemeDef
} from '@shared/code-themes'

/** Monaco theme colors are bare hex without the leading '#'. */
function rgb(hex: string): string {
  return hex.replace(/^#/, '')
}

/** Turn a shared palette into a Monaco theme definition. Tokens are matched
 * by prefix, so 'type' also covers 'type.identifier' and 'entity.name'
 * covers function/class names. */
function toMonacoThemeData(def: CodeThemeDef): monaco.editor.IStandaloneThemeData {
  return {
    base: def.base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: rgb(def.tokens.comment), fontStyle: def.italicComment ? 'italic' : '' },
      { token: 'keyword', foreground: rgb(def.tokens.keyword) },
      { token: 'string', foreground: rgb(def.tokens.string) },
      { token: 'number', foreground: rgb(def.tokens.number) },
      { token: 'type', foreground: rgb(def.tokens.type) },
      { token: 'identifier', foreground: rgb(def.colors.fg) },
      { token: 'entity.name', foreground: rgb(def.tokens.fn) },
      { token: 'delimiter', foreground: rgb(def.colors.fg) }
    ],
    colors: {
      'editor.background': def.colors.bg,
      'editor.foreground': def.colors.fg,
      'editorLineNumber.foreground': def.colors.gutter,
      'editorLineNumber.activeForeground': def.colors.gutterActive,
      'editor.selectionBackground': def.colors.selection,
      'editor.lineHighlightBackground': def.colors.lineHighlight
    }
  }
}

let registered = false

/** Idempotent: every editor/diff mount and the settings panel call this on
 * import, but defineTheme only needs to run once per session. */
export function registerCodeThemes(): void {
  if (registered) return
  registered = true
  for (const def of CODE_THEMES) {
    monaco.editor.defineTheme(def.id, toMonacoThemeData(def))
  }
}

// Registering at import is safe: monaco.ts has already configured the loader
// and both code-hosting nodes import the same module graph.
registerCodeThemes()

interface CodeThemeState {
  /** Saved setting ids (already normalized; fall back to defaults if absent). */
  light: string
  dark: string
  /** Resolved UI theme — the slot whose code theme is live right now. */
  ui: 'light' | 'dark'
  sync: (light: string | undefined, dark: string | undefined) => void
  setUi: (ui: 'light' | 'dark') => void
}

export const useCodeTheme = create<CodeThemeState>((set) => ({
  light: DEFAULT_CODE_THEME_LIGHT,
  dark: DEFAULT_CODE_THEME_DARK,
  ui: 'dark',
  sync: (light, dark) =>
    set((s) => ({
      light: light ?? s.light,
      dark: dark ?? s.dark
    })),
  setUi: (ui) => set({ ui })
}))

/** Zustand-friendly selector: the Monaco theme id code nodes should show. */
export function activeCodeThemeId(s: Pick<CodeThemeState, 'light' | 'dark' | 'ui'>): string {
  return s.ui === 'light' ? s.light : s.dark
}
