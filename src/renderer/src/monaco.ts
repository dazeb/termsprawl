// Monaco loader setup — shared by the diff node now, the editor node later.
// Monaco must load from node_modules (no CDN — this is a desktop app); vite
// bundles the editor worker via the `?worker` import. The renderer CSP allows
// `worker-src 'self' blob:` for exactly this.

import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'

// Set before any editor mounts: Monaco asks this for its workers.
self.MonacoEnvironment = {
  getWorker: () => new editorWorker()
}

loader.config({ monaco })

export { monaco }

/** Map a file extension to a Monaco language id; default plaintext. */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    rb: 'ruby',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    sql: 'sql',
    toml: 'ini',
    ini: 'ini',
    txt: 'plaintext',
    log: 'plaintext'
  }
  return map[ext] ?? 'plaintext'
}
