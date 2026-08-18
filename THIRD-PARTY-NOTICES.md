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

## Notes

- monaco-editor ships its own web workers (editor.worker, language workers).
  termsprawl loads them locally via vite `?worker` imports — no CDN.
- tmux is an external runtime requirement, not bundled (see README).
