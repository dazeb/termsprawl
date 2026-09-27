// Code-theme registry: the syntax-highlighting palettes offered in
// Settings ▸ Appearance ▸ Code theme. PURE DATA on purpose — the core
// settings normalizer validates saved ids against this list, so this file
// must never import Monaco (or anything Electron/renderer-side). The
// renderer turns each palette into a real Monaco theme; the settings panel
// renders previews straight from the same numbers, so what the preview
// shows is exactly what the editor gets.
//
// Clean-room note: the palettes are our own approximations of well-known
// editor looks — no theme files are copied from anywhere. House rule: no
// purple anywhere (see AGENTS.md), so every token color avoids violet hues;
// src/shared/code-themes.test.ts guards that.

export type CodeThemeKind = 'light' | 'dark'

/** One syntax token color, shared by the Monaco rules and the preview. */
export interface CodeThemeTokens {
  comment: string
  keyword: string
  string: string
  number: string
  type: string
  fn: string
}

/** Editor chrome colors (background, gutter, selection) in '#rrggbb'. */
export interface CodeThemeColors {
  bg: string
  fg: string
  gutter: string
  gutterActive: string
  selection: string
  lineHighlight: string
}

export interface CodeThemeDef {
  id: string
  label: string
  kind: CodeThemeKind
  /** Monaco base theme the rules inherit from. */
  base: 'vs' | 'vs-dark'
  colors: CodeThemeColors
  tokens: CodeThemeTokens
  /** Italic comments, where the look calls for it. */
  italicComment?: boolean
}

export const CODE_THEMES: CodeThemeDef[] = [
  {
    id: 'classic-light',
    label: 'Classic Light',
    kind: 'light',
    base: 'vs',
    colors: {
      bg: '#ffffff',
      fg: '#1f2328',
      gutter: '#9ca3af',
      gutterActive: '#6b7280',
      selection: '#b4d5fe',
      lineHighlight: '#f6f8fa'
    },
    tokens: {
      comment: '#008000',
      keyword: '#0000ff',
      string: '#a31515',
      number: '#098658',
      type: '#267f99',
      fn: '#795e26'
    }
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    kind: 'light',
    base: 'vs',
    colors: {
      bg: '#ffffff',
      fg: '#1f2328',
      gutter: '#8c959f',
      gutterActive: '#57606a',
      selection: '#cfe3ff',
      lineHighlight: '#f6f8fa'
    },
    tokens: {
      comment: '#6e7781',
      keyword: '#cf222e',
      string: '#0a3069',
      number: '#0550ae',
      type: '#116329',
      fn: '#953800'
    }
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    kind: 'light',
    base: 'vs',
    colors: {
      bg: '#fdf6e3',
      fg: '#657b83',
      gutter: '#93a1a1',
      gutterActive: '#586e75',
      selection: '#eee8d5',
      lineHighlight: '#eee8d5'
    },
    tokens: {
      comment: '#93a1a1',
      keyword: '#859900',
      string: '#2aa198',
      number: '#cb4b16',
      type: '#b58900',
      fn: '#268bd2'
    }
  },
  {
    id: 'classic-dark',
    label: 'Classic Dark',
    kind: 'dark',
    base: 'vs-dark',
    colors: {
      bg: '#1e1e1e',
      fg: '#d4d4d4',
      gutter: '#6e7681',
      gutterActive: '#c6c6c6',
      selection: '#264f78',
      lineHighlight: '#282828'
    },
    tokens: {
      comment: '#6a9955',
      keyword: '#569cd6',
      string: '#ce9178',
      number: '#b5cea8',
      type: '#4ec9b0',
      fn: '#dcdcaa'
    }
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    kind: 'dark',
    base: 'vs-dark',
    colors: {
      bg: '#0d1117',
      fg: '#e6edf3',
      gutter: '#6e7681',
      gutterActive: '#c9d1d9',
      selection: '#264f78',
      lineHighlight: '#161b22'
    },
    tokens: {
      comment: '#8b949e',
      keyword: '#ff7b72',
      string: '#a5d6ff',
      number: '#79c0ff',
      type: '#ffa657',
      fn: '#7ee787'
    }
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    kind: 'dark',
    base: 'vs-dark',
    colors: {
      bg: '#282c34',
      fg: '#abb2bf',
      gutter: '#5c6370',
      gutterActive: '#c8ccd4',
      selection: '#3e4451',
      lineHighlight: '#2c313c'
    },
    tokens: {
      comment: '#5c6370',
      keyword: '#56b6c2',
      string: '#98c379',
      number: '#d19a66',
      type: '#e5c07b',
      fn: '#61afef'
    },
    italicComment: true
  },
  {
    id: 'vitesse-dark',
    label: 'Vitesse Dark',
    kind: 'dark',
    base: 'vs-dark',
    colors: {
      bg: '#181818',
      fg: '#dbd7ca',
      gutter: '#4e5852',
      gutterActive: '#8a938c',
      selection: '#2f3e46',
      lineHighlight: '#1e1e1e'
    },
    tokens: {
      comment: '#758575',
      keyword: '#4d9375',
      string: '#c98a7d',
      number: '#e0a068',
      type: '#cbcb9c',
      fn: '#5db0d3'
    },
    italicComment: true
  }
]

export const DEFAULT_CODE_THEME_LIGHT = 'github-light'
export const DEFAULT_CODE_THEME_DARK = 'one-dark'

export function codeThemeById(id: string): CodeThemeDef | undefined {
  return CODE_THEMES.find((t) => t.id === id)
}

/** All registry ids of one kind — the option list for a settings select. */
export function codeThemesOfKind(kind: CodeThemeKind): CodeThemeDef[] {
  return CODE_THEMES.filter((t) => t.kind === kind)
}
