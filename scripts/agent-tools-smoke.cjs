// Run with Electron after pnpm run build. Uses an isolated home/project and fixture
// agent CLIs; never sends model requests or touches the user's agent configuration.
const { app, BrowserWindow } = require('electron')
const { syncBuiltinESMExports } = require('node:module')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const appRoot = path.resolve(process.env.TERMSPRAWL_SMOKE_APP_ROOT || path.join(__dirname, '..'))
const restarting = process.env.TERMSPRAWL_SMOKE_RESTART === '1'
const root = process.env.TERMSPRAWL_SMOKE_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'termsprawl agent smoke '))
const home = path.join(root, 'home')
const data = path.join(root, 'data')
const project = path.join(root, 'project')
const bin = path.join(root, 'bin')
for (const dir of [home, path.join(home, '.claude'), data, project, bin, path.join(project, '.termsprawl')]) fs.mkdirSync(dir, { recursive: true })
os.homedir = () => home
syncBuiltinESMExports()
app.setPath('userData', data)
app.getAppPath = () => appRoot
if (process.env.TERMSPRAWL_SMOKE_RUNTIME) process.execPath = path.resolve(process.env.TERMSPRAWL_SMOKE_RUNTIME)
app.disableHardwareAcceleration()
process.env.PATH = bin + ':' + process.env.PATH
process.env.SHELL = '/bin/bash'
fs.writeFileSync(path.join(bin, 'grok'), '#!/bin/sh\ncase "$1" in --help) echo "Usage: grok [PROMPT]"; exit;; --version) echo fixture-1; exit;; esac\nexec /bin/bash --noprofile --norc\n', { mode: 0o700 })
if (!restarting) {
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ agentBrowserControl: true, onboardedAt: new Date().toISOString() }))
fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify({ version: 1, projects: [{ id: 'p-smoke', name: 'Agent tools smoke test', cwd: project, closed: false }] }))
const terminal = id => ({ id, type: 'terminal', position: { x: id === 'agent-a' ? 0 : 800, y: 0 }, style: { width: 720, height: 420 }, data: { kind: 'terminal', title: id, cwd: project, command: 'grok' } })
fs.writeFileSync(path.join(project, '.termsprawl/project.json'), JSON.stringify({ version: 1, rev: 1, nodes: [terminal('agent-a'), terminal('agent-b')] }))
}
let pageServer
const timeout = setTimeout(() => { console.error('FAIL: smoke timeout'); cleanup(1) }, 90_000)
const delay = ms => new Promise(r => setTimeout(r, ms))
async function until(check, label) { for (let i = 0; i < 150; i++) { if (await check()) return; await delay(100) } throw new Error('Timed out: ' + label) }
async function call(agent, operation, args = {}, allowError = false) {
  const tools = path.join(data, 'agent-tools')
  const { token } = JSON.parse(fs.readFileSync(path.join(tools, 'sessions', agent + '.json')))
  const { url } = JSON.parse(fs.readFileSync(path.join(tools, 'endpoint.json')))
  const result = await (await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ operation, args }) })).json()
  if (!allowError) assert.equal(result.ok, true, JSON.stringify(result))
  return result.ok ? result.value : result
}
async function cleanup(code) {
  clearTimeout(timeout)
  if (pageServer) pageServer.close()
  try { execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'kill-server'], { stdio: 'ignore' }) } catch {}
  // App's normal shutdown closes the service. The data is useful when a test fails.
  console.log('Smoke data:', root)
  app.exit(code)
}
async function test() {
  await until(() => fs.existsSync(path.join(data, 'agent-tools/sessions/agent-b.json')), 'agent launch')
  await until(async () => { try { return (await call('agent-a', 'canvas_list')).length >= 2 } catch { return false } }, 'canvas ready')
  const session = await call('agent-a', 'session_info')
  if (restarting) {
    const previous = JSON.parse(fs.readFileSync(path.join(root, 'restart-proof.json')))
    const currentPid = execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'display-message', '-p', '-t', '=ts-agent-a:', '#{pane_pid}'], { encoding: 'utf8' }).trim()
    const credential = JSON.parse(fs.readFileSync(path.join(data, 'agent-tools/sessions/agent-a.json')))
    const digest = require('node:crypto').createHash('sha256').update(credential.token).digest('hex')
    assert.equal(currentPid, previous.pid)
    assert.equal(digest, previous.tokenDigest)
    assert.notEqual(session.instanceId, previous.instanceId)
    console.log('PASS app restart preserves the running agent and reconnects with stable credentials')
    await cleanup(0)
    return
  }
  assert.equal(session.status.state, 'cli-fallback')
  const helper = path.join(data, 'agent-tools/termsprawlctl')
  const sessionFile = path.join(data, 'agent-tools/sessions/agent-a.json')
  // Async: the service is in this process and must keep handling requests.
  const doctor = await new Promise((resolve, reject) => {
    const child = spawn(helper, ['--session', sessionFile, 'doctor'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)))
  })
  assert.equal(doctor.ok, true)
  console.log('PASS automatic launch identity and bundled-runtime doctor')

  const mcp = await new Promise((resolve, reject) => {
    const child = spawn(helper, ['--session', sessionFile, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output.trim().split('\n').map(JSON.parse)) : reject(new Error(error)))
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'canvas_list', arguments: {} } }
    ].map(JSON.stringify).join('\n') + '\n')
  })
  assert.equal(mcp.length, 3)
  assert(mcp[1].result.tools.some(t => t.name === 'browser_open'))
  assert.equal(mcp[2].result.isError, false)
  console.log('PASS MCP initialization, tool discovery and invocation')

  pageServer = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Tool smoke</title><input id="name"><button id="apply" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Apply</button><p id="result"></p>') })
  await new Promise(r => pageServer.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + pageServer.address().port
  const browser = await call('agent-a', 'browser_open', { url })
  assert(browser.targetId)
  await call('agent-a', 'browser_type', { nodeId: browser.nodeId, selector: '#name', text: 'tool-smoke-ok' })
  await call('agent-a', 'browser_click', { nodeId: browser.nodeId, selector: '#apply' })
  await until(async () => (await call('agent-a', 'browser_inspect', { nodeId: browser.nodeId })).text.includes('tool-smoke-ok'), 'browser click')
  const capture = await call('agent-a', 'browser_screenshot', { nodeId: browser.nodeId })
  assert(Buffer.from(capture.image, 'base64').length > 100)
  assert.equal((await call('agent-b', 'browser_inspect', { nodeId: browser.nodeId }, true)).ok, false)
  await call('agent-a', 'browser_transfer', { nodeId: browser.nodeId, agentNodeId: 'agent-b' })
  await call('agent-b', 'browser_navigate', { nodeId: browser.nodeId, url })
  console.log('PASS visible browser navigation, typing, clicking, screenshots and ownership transfer')

  const terminal = await call('agent-a', 'terminal_open', { title: 'Tool smoke shell' })
  await call('agent-a', 'terminal_submit', { nodeId: terminal.nodeId, command: "printf '%s%s\\n' terminal- smoke-ok" })
  await until(async () => (await call('agent-a', 'terminal_read', { nodeId: terminal.nodeId })).output.includes('terminal-smoke-ok'), 'terminal output')
  // Validate the helper credentials actually reached the new agent's tmux pane.
  const paneEnv = execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'show-environment', '-t', 'ts-agent-a', 'TERMSPRAWL_SESSION_FILE'], { encoding: 'utf8' })
  assert(paneEnv.includes(sessionFile))
  await call('agent-a', 'terminal_external', { nodeId: terminal.nodeId })
  await until(() => execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'list-clients', '-t', 'ts-' + terminal.nodeId], { encoding: 'utf8' }).trim().split('\n').length >= 2, 'external terminal attachment')
  await call('agent-a', 'terminal_close', { nodeId: terminal.nodeId })
  assert(!(await call('agent-a', 'canvas_list')).some(n => n.id === terminal.nodeId))
  const sticky = await call('agent-a', 'sticky_open', { text: 'Tools work' })
  await call('agent-a', 'canvas_move', { nodeId: sticky.nodeId, x: 20, y: 700 })
  console.log('PASS terminal input/output, external window, session close and canvas persistence')
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))
  const errors = await win.webContents.executeJavaScript("document.querySelector('.app-error-banner')?.textContent || ''")
  assert.equal(errors, '')
  console.log('PASS Electron smoke test')
  if (process.env.TERMSPRAWL_SMOKE_PRESERVE === '1') {
    const credential = JSON.parse(fs.readFileSync(sessionFile))
    const tokenDigest = require('node:crypto').createHash('sha256').update(credential.token).digest('hex')
    const pid = execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'display-message', '-p', '-t', '=ts-agent-a:', '#{pane_pid}'], { encoding: 'utf8' }).trim()
    fs.writeFileSync(path.join(root, 'restart-proof.json'), JSON.stringify({ pid, tokenDigest, instanceId: session.instanceId }))
    clearTimeout(timeout)
    pageServer.close()
    console.log('Smoke data:', root)
    app.quit()
    return
  }
  await cleanup(0)
}
import(pathToFileURL(path.join(appRoot, 'out/main/index.js')).href).then(() => test()).catch(async error => { console.error(error); await cleanup(1) })
