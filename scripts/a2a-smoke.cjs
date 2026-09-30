// Built Electron + real tmux/PTYS + fixture agents. No model calls or user profiles.
// Run after pnpm run verify: XDG_SESSION_TYPE= xvfb-run -a node_modules/electron/dist/electron
// scripts/a2a-smoke.cjs --no-sandbox --disable-gpu
const { app, BrowserWindow } = require('electron')
const { syncBuiltinESMExports } = require('node:module')
const { pathToFileURL } = require('node:url')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const appRoot = path.resolve(__dirname, '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termsprawl a2a smoke '))
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'project'), bin = path.join(root, 'bin')
for (const dir of [home, path.join(home, '.claude'), data, project, bin, path.join(project, '.termsprawl')]) fs.mkdirSync(dir, { recursive: true })
os.homedir = () => home
syncBuiltinESMExports()
app.setPath('userData', data)
app.getAppPath = () => appRoot
app.disableHardwareAcceleration()
process.env.PATH = bin + ':' + process.env.PATH
process.env.SHELL = '/bin/bash'
// Xvfb is X11 even when the host desktop is Wayland. Avoid the app's
// deliberate desktop relaunch creating a detached copy of this harness.
process.env.XDG_SESSION_TYPE = ''

const fixture = `#!/usr/bin/python3
import os, sys, tty, re, json, subprocess
if '--help' in sys.argv:
    print('--config mcp' if os.path.basename(sys.argv[0]) == 'codex' else '--prompt-interactive'); sys.exit()
if '--version' in sys.argv: print('fixture-1'); sys.exit()
instructions = open(os.environ['TERMSPRAWL_SYSTEM_PROMPT_FILE']).read().strip()
assert '# Termsprawl session instructions' in instructions and 'agent_reply' in instructions
if os.path.basename(sys.argv[0]) == 'codex':
    connected = subprocess.run([os.environ['TERMSPRAWL_CTL'], 'mcp'], input=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}) + '\\n', text=True, capture_output=True, timeout=5)
    assert connected.returncode == 0 and json.loads(connected.stdout)['result']['instructions'] == instructions
else:
    assert sys.argv[sys.argv.index('--prompt-interactive') + 1] == instructions
tty.setraw(0)
os.write(1, b'fixture agent ready\\r\\n')
pending = b''
while True:
    chunk = os.read(0, 65536)
    if not chunk: break
    pending += chunk
    if b'\\r' not in pending: continue
    prompt, pending = pending.split(b'\\r', 1)
    text = prompt.decode('utf8', errors='replace')
    match = re.search(r'Task ID: ([a-zA-Z0-9_-]+)', text)
    if not match: continue
    assert 'peer data' in text and 'agent_reply' in text
    reply = subprocess.run([os.environ['TERMSPRAWL_CTL'], 'call', 'agent_reply', json.dumps({'taskId': match[1], 'text': 'fixture Gemini reply', 'state': 'completed'})], capture_output=True)
    os.write(1, b'reply helper: ' + reply.stdout + reply.stderr + b'\\r\\n')
`
for (const agent of ['codex', 'gemini']) fs.writeFileSync(path.join(bin, agent), fixture, { mode: 0o700 })
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ onboardedAt: new Date().toISOString() }))
fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify({ version: 1, projects: [{ id: 'p-a2a', name: 'A2A smoke', cwd: project, closed: false }] }))
const nodes = ['codex', 'gemini'].map((agent, i) => ({ id: agent, type: 'terminal', position: { x: i * 650, y: 0 },
  style: { width: 600, height: 380 }, data: { kind: 'terminal', agentId: agent, title: agent, command: agent, cwd: project } }))
fs.writeFileSync(path.join(project, '.termsprawl/project.json'), JSON.stringify({ version: 1, rev: 1, nodes,
  links: [{ id: 'request-link', source: 'codex', target: 'gemini', kind: 'context-inject', auto: false,
    config: { kind: 'context-inject', wrapper: true, pastePointer: false }, createdAt: Date.now() }] }))

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => cleanup(1, new Error('A2A smoke timed out')), 60000)
async function until(check, label) { for (let i = 0; i < 100; i++) { if (await check()) return; await delay(100) } throw new Error('Timed out: ' + label) }
async function call(agent, operation, args = {}) {
  const helper = path.join(data, 'agent-tools', 'termsprawlctl')
  const session = path.join(data, 'agent-tools', 'sessions', agent + '.json')
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ['--session', session, 'call', operation, JSON.stringify(args)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', chunk => { out += chunk }); child.stderr.on('data', chunk => { err += chunk })
    child.on('error', reject)
    child.on('close', code => { try { const result = JSON.parse(out); if (code || !result.ok) reject(new Error(result.error || err)); else resolve(result.value) } catch (e) { reject(e) } })
  })
}
async function cleanup(code, error) {
  clearTimeout(timeout)
  if (error) console.error(error)
  try { execFileSync('/usr/bin/tmux', ['-S', path.join(data, 'tmux-sockets/termsprawl'), 'kill-server'], { stdio: 'ignore', timeout: 3000 }) } catch {}
  if (code === 0) fs.rmSync(root, { recursive: true, force: true })
  else console.log('Smoke data:', root)
  // This isolated harness already destroyed its tmux server; terminate its
  // Node process directly so Chromium teardown cannot hold the check open.
  process.reallyExit(code)
}
async function test() {
  await until(() => fs.existsSync(path.join(data, 'agent-tools/sessions/gemini.json')), 'automatic integration')
  await call('codex', 'session_info')
  await until(async () => { try { return (await call('codex', 'terminal_read', { nodeId: 'codex' })).output.includes('fixture agent ready') } catch { return false } }, 'Codex MCP prompt')
  await until(async () => { try { return (await call('codex', 'terminal_read', { nodeId: 'gemini' })).output.includes('fixture agent ready') } catch { return false } }, 'recipient prompt')
  const systemPrompt = fs.readFileSync(path.join(appRoot, 'src/core/prompts/termsprawl-system.md'), 'utf8').trim()
  for (const agent of ['codex', 'gemini']) assert.equal(fs.readFileSync(path.join(data, 'agent-tools/launch', agent, 'termsprawl-system.md'), 'utf8').trim(), systemPrompt)
  const codexGuide = fs.readFileSync(path.join(data, 'agent-tools/launch/codex/skills/termsprawl-agents/SKILL.md'), 'utf8')
  assert.equal(codexGuide, fs.readFileSync(path.join(data, 'agent-tools/launch/gemini/skills/termsprawl-agents/SKILL.md'), 'utf8'))
  await assert.rejects(call('codex', 'agent_send', { nodeId: 'gemini', text: 'review', messageId: 'disabled' }), /enabled outgoing/)

  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))
  await win.webContents.executeJavaScript(`(() => {
    const edge = document.querySelector('.react-flow__edge path');
    if (!edge) throw new Error('Link edge missing');
    for (const type of ['mousedown', 'mouseup', 'click']) edge.dispatchEvent(new MouseEvent(type, {bubbles:true}));
  })()`)
  await until(async () => win.webContents.executeJavaScript(`Boolean(Array.from(document.querySelectorAll('.link-inspector label')).find(e => e.textContent.includes('Allow agent requests')))`), 'request checkbox')
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.link-inspector label')).find(e => e.textContent.includes('Allow agent requests')).querySelector('input').click()`)
  await until(async () => (await call('codex', 'agent_cards')).find(c => c.nodeId === 'codex').enabledPeerIds.includes('gemini'), 'grant persistence')
  const args = { nodeId: 'gemini', text: 'Review this request\nwith multiline context.', messageId: 'smoke-review' }
  const sent = await call('codex', 'agent_send', args)
  await until(async () => (await call('codex', 'agent_task', { taskId: sent.id })).state === 'completed', 'recipient reply')
  assert.equal((await call('codex', 'agent_task', { taskId: sent.id })).response, 'fixture Gemini reply')
  assert.equal((await call('codex', 'agent_send', args)).id, sent.id)
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.app-error-banner')?.textContent || ''"), '')
  console.log('PASS shared prompt file, Codex MCP instructions, Gemini startup prompt, visible link opt-in, real PTY automatic submission, Gemini helper reply and exact-retry deduplication')
  await cleanup(0)
}
import(pathToFileURL(path.join(appRoot, 'out/main/index.js')).href).then(test).catch(error => cleanup(1, error))
