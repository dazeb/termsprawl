// App theme resolution. 'system' follows the OS via prefers-color-scheme; the
// resolved 'light' | 'dark' is reflected onto the root <html data-theme> so the
// stylesheet can switch variable palettes. Code nodes read the same resolution
// through the code-themes store (which palette is live right now).

import { useCodeTheme } from './code-themes'

export type ThemeChoice = 'light' | 'dark' | 'system'

const media = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return media?.matches ? 'light' : 'dark'
  return choice
}

let onSystemChange: (() => void) | null = null

function refreshSystemListener(): void {
  if (!media) return
  if (onSystemChange) {
    media.removeEventListener('change', onSystemChange)
    onSystemChange = null
  }
  media.addEventListener('change', () => {
    if (currentChoice === 'system') applyTheme(currentChoice)
  })
}

let currentChoice: ThemeChoice = 'system'

export function applyTheme(choice: ThemeChoice): void {
  currentChoice = choice
  const resolved = resolveTheme(choice)
  document.documentElement.dataset.theme = resolved
  useCodeTheme.getState().setUi(resolved)
  if (choice === 'system' && !onSystemChange) refreshSystemListener()
}
