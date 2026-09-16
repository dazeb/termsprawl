# Third-party notices

termsprawl bundles third-party open-source software. Every bundled dependency
gets an entry here (policy from PLAN.md task 0.3). Licenses are reproduced or
linked; full texts live in the respective package's `LICENSE` file under
`node_modules/` and in the pnpm store.

## Runtime dependencies

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| node-pty | ^1.1.0 | MIT | PTY spawn for terminal nodes |
| @xterm/xterm | ^5.3.0 | MIT | Terminal rendering |
| @xterm/addon-fit | ^0.11.0 | MIT | Terminal fit-to-node |
| reactflow | ^11.11.4 | MIT | Canvas / node graph |
| react | ^19.2.8 | MIT | UI framework |
| react-dom | ^19.2.8 | MIT | UI framework |
| zustand | ^5.0.15 | MIT | Renderer state |
| monaco-editor | ^0.56.0 | MIT | Editor / diff rendering |
| @monaco-editor/react | ^4.7.0 | MIT | React bindings for Monaco |
| marked | ^18.0.9 | MIT | Markdown preview in editor nodes |
| electron-updater | ^6.8.9 | MIT | GitHub Releases auto-update |

## Notes

- monaco-editor ships its own web workers (editor.worker, language workers).
  termsprawl loads them locally via vite `?worker` imports — no CDN.
- tmux is an external runtime requirement, not bundled (see README).

## Agent logo SVGs

Claude, OpenAI (Codex), Grok, and Antigravity marks in
`src/renderer/src/assets/agents/` are from [Lobe Icons](https://github.com/lobehub/lobe-icons),
commit `a94750e3f5f8fc33757b839d85030e742284e43a`,
`packages/static-svg/icons/`. Used in monochrome to identify the corresponding
agent; trademarks belong to their respective owners. OpenClaude uses an original
text monogram, not an upstream logo.

MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
