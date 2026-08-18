// Markdown → HTML for the editor node's preview pane.
// Raw HTML from the source is dropped (no <script>, no inline markup pass-through).

import { Marked } from 'marked'

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html() {
      return ''
    }
  }
})

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string
}
