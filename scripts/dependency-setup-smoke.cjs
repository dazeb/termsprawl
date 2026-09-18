// Production Electron UI smoke in an isolated home. Installer responses are fixtures;
// real distribution downloads are covered by dependency-install.smoke.test.ts.
const { app, BrowserWindow } = require('electron')
const { syncBuiltinESMExports } = require('node:module')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termsprawl-setup-ui-'))
const home = path.join(root, 'home'), data = path.join(root, 'data')
fs.mkdirSync(home); fs.mkdirSync(data)
os.homedir = () => home; syncBuiltinESMExports()
process.env.HOME = home; process.env.PATH = '/usr/bin:/bin'; process.env.SHELL = '/bin/bash'
app.setPath('userData', data); app.disableHardwareAcceleration()
const appRoot = path.resolve(process.env.TERMSPRAWL_SMOKE_APP_ROOT || path.join(__dirname, '..'))
app.getAppPath = () => appRoot
let attempts = 0
const originalFetch = global.fetch
global.fetch = async (url, options) => {
  const address = String(url)
  let response
  if (address === 'https://api.github.com/repos/anomalyco/opencode/releases/latest') response = new Response(JSON.stringify({ tag_name: 'v1.2.3', prerelease: false, draft: false }))
  if (address === 'https://opencode.ai/install') {
    attempts++
    if (attempts === 1) response = new Response('temporary failure', { status: 503 })
    else response = new Response('#!/bin/bash\nset -eu\nsleep 2\nmkdir -p "$HOME/.opencode/bin"\ncat > "$HOME/.opencode/bin/opencode" <<\'AGENT\'\n#!/bin/sh\ncase "$1" in --version) echo 1.2.3; exit;; --help) echo "opencode --prompt text"; exit;; esac\nexec /bin/bash --noprofile --norc\nAGENT\nchmod +x "$HOME/.opencode/bin/opencode"\n')
  }
  if (response) { Object.defineProperty(response, 'url', { value: address }); return response }
  return originalFetch(url, options)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let win
async function js(code) { return win.webContents.executeJavaScript(code) }
async function until(check, label) { for (let i = 0; i < 200; i++) { if (await check()) return; await delay(100) } throw new Error(`Timed out: ${label}`) }
async function button(text, scope = 'document') {
  return js(`(() => { const b = [...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw Error('Missing button: '+${JSON.stringify(text)}); b.click(); return true })()`)
}
async function cleanup(code) {
  try { execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'kill-server'], { stdio: 'ignore' }) } catch {}
  console.log('Setup UI smoke data:', root)
  app.exit(code)
}
const timer = setTimeout(() => { console.error('UI smoke timeout'); cleanup(1) }, 120000)
async function test() {
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => js("!!document.querySelector('.onboarding-card')"), 'onboarding')
  await button('Check your setup', "document.querySelector('.onboarding-card')")
  await until(() => js("document.querySelectorAll('.setup-item').length >= 6"), 'setup checks')
  const scope = "[...document.querySelectorAll('.setup-item')].find(e => e.querySelector('strong')?.textContent === 'OpenCode')"
  await button('Install', scope)
  await until(async () => (await js('window.termsprawl.dependencies.status()'))?.state === 'failed', 'failure surfaced')
  await until(() => js("document.querySelector('.setup-dialog').textContent.includes('HTTP 503')"), 'error message')
  await button('Retry', scope)
  await button('Close', "document.querySelector('.setup-dialog')")
  await until(async () => (await js('window.termsprawl.dependencies.status()'))?.state === 'installed', 'closed panel installation')
  const checked = await js('window.termsprawl.dependencies.check(true)')
  assert.equal(checked.dependencies.find(d => d.id === 'opencode').managed, true)
  const project = await js("window.termsprawl.workspace.addProject('Setup smoke', null)")
  // Reload hydrates the project through the real workspace store.
  win.reload()
  await until(() => js("!!document.querySelector('.react-flow__pane')").catch(() => false), 'canvas reload')
  await js("document.querySelector('.react-flow__pane').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 350, clientY: 250 }))")
  await until(() => js("[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.includes('OpenCode'))"), 'agent menu')
  await js("[...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.includes('OpenCode')).click()")
  await until(() => js("!!document.querySelector('.terminal-node')"), 'OpenCode node')
  await delay(2000)
  const snapshot = await js('window.termsprawl.workspace.snapshot()')
  const node = Object.values(snapshot.projects).flat().find(n => n.data.agentId === 'opencode')
  assert.ok(node, 'OpenCode persisted with its own agent identity')
  assert.equal(node.data.command, 'opencode')
  await js("window.termsprawl.pty.write(" + JSON.stringify(node.id) + ", 'echo SETUP_LAUNCH_OK\\r')")
  await delay(1000)
  const pane = execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'capture-pane', '-p', '-t', 'ts-' + node.id], { encoding: 'utf8' })
  assert.match(pane, /SETUP_LAUNCH_OK/)
  await js("window.termsprawl.dependencies.install('opencode')")
  await until(async () => (await js('window.termsprawl.dependencies.status()'))?.state === 'failed', 'active update refused')
  assert.match((await js('window.termsprawl.dependencies.status()')).error, /Close this agent/)
  await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(root, 'setup-ui.png'), image.toPNG()))
  console.log('PASS onboarding, failed download, retry, background install, detection, canvas launch, persisted identity, live PTY, active update refusal')
  clearTimeout(timer); await cleanup(0)
}
import(pathToFileURL(path.join(appRoot, 'out/main/index.js')).href).then(test).catch(async error => { console.error(error); clearTimeout(timer); await cleanup(1) })
