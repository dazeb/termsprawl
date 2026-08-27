// Monaco loader setup — shared by editor + diff nodes.
// Monaco must load from node_modules (no CDN — this is a desktop app); vite
// bundles the workers via `?worker` imports. The renderer CSP allows
// `worker-src 'self' blob:` for exactly this.
//
// Worker routing (learned 2026-08-27, monaco-editor 0.56):
// Monaco asks this for EVERY worker it needs — the editor worker AND the
// per-language workers (json/css/html/ts). Returning the editor worker for a
// language label routes language RPCs (e.g. getFoldingRanges, hover, symbols)
// into a worker whose foreign module is empty, so every such call rejects
// with "Missing requestHandler or method: getFoldingRanges" (fired on any
// editor relayout, i.e. every window/node resize). Return the right worker per
// label instead.

import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import cssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import htmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import tsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import { loader } from '@monaco-editor/react'

// Set before any editor mounts: Monaco asks this for its workers.
self.MonacoEnvironment = {
  getWorker: (_workerId: string, label: string): Worker => {
    switch (label) {
      case 'editorWorkerService':
        return new editorWorker()
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        // Unknown label — no language features; the editor worker still
        // handles the base editor RPCs (diff, links, word ranges…).
        return new editorWorker()
    }
  }
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
