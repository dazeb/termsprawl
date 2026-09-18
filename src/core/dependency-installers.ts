import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallableAgent } from '../shared/dependencies'
import { findExecutable } from './command-resolver'
import { shellQuote } from './agent-tool-launch'

const CLAUDE_RELEASES = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'
const AGY_RELEASES = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app'
export interface Release { version: string; source: string; nodeMinimum?: number }
export const INSTALL_SOURCES: Record<InstallableAgent, string> = {
  claude: 'https://claude.ai/install.sh', codex: 'https://github.com/openai/codex',
  grok: 'https://x.ai/cli/install.sh', gemini: 'https://antigravity.google/cli/install.sh',
  openclaude: 'https://registry.npmjs.org/@gitlawb%2fopenclaude/latest', opencode: 'https://opencode.ai/install'
}
export function stableVersion(value: string): string {
  const version = value.trim().replace(/^(rust-)?v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a stable release: ${value}`)
  return version
}
export function linuxArch(arch: string): 'x64' | 'arm64' {
  if (arch !== 'x64' && arch !== 'arm64') throw new Error(`Unsupported Linux architecture: ${arch}`)
  return arch
}
export async function download(url: string, maxBytes = 4 * 1024 * 1024): Promise<Buffer> {
  if (new URL(url).protocol !== 'https:') throw new Error('Downloads require HTTPS')
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { 'User-Agent': 'termsprawl-setup' } })
  if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') throw new Error(`Download failed: HTTP ${response.status} (${new URL(url).hostname})`)
  const chunks: Uint8Array[] = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maxBytes) { throw new Error('Download exceeds size limit') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function json(url: string): Promise<any> { return JSON.parse((await download(url)).toString('utf8')) }
export async function latestRelease(id: InstallableAgent, arch = process.arch): Promise<Release> {
  linuxArch(arch)
  let version: string
  let nodeMinimum: number | undefined
  if (id === 'claude') version = (await download(`${CLAUDE_RELEASES}/stable`)).toString()
  else if (id === 'grok') version = (await download('https://x.ai/cli/stable')).toString()
  else if (id === 'gemini') {
    const musl = !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime
    version = (await json(`${AGY_RELEASES}/manifests/linux_${arch === 'x64' ? 'amd64' : 'arm64'}${musl ? '_musl' : ''}.json`)).version
  } else if (id === 'openclaude') {
    const pkg = await json(INSTALL_SOURCES.openclaude)
    if (pkg.name !== '@gitlawb/openclaude') throw new Error('Unexpected npm package')
    version = pkg.version
    const match = /^>=\s*(\d+)(?:\.\d+){0,2}$/.exec(pkg.engines?.node ?? '')
    if (!match) throw new Error('Unrecognized Node requirement; consult OpenClaude installation documentation')
    nodeMinimum = Math.max(22, Number(match[1]))
  } else {
    const repo = id === 'codex' ? 'openai/codex' : 'anomalyco/opencode'
    const release = await json(`https://api.github.com/repos/${repo}/releases/latest`)
    if (release.prerelease || release.draft) throw new Error('Expected a stable published release')
    version = release.tag_name
  }
  return { version: stableVersion(version), source: INSTALL_SOURCES[id], nodeMinimum }
}

const runningChildren = new Set<number>()
export function stopSetupProcesses(): void {
  for (const pid of runningChildren) { try { process.kill(-pid, 'SIGKILL') } catch { /* exited */ } }
}
export function runProcess(file: string, args: string[], env: NodeJS.ProcessEnv, log: (text: string) => void, timeout = 15 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    if (child.pid) runningChildren.add(child.pid)
    let output = ''; let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
    }, timeout)
    const append = (data: Buffer): void => { const text = data.toString(); output = (output + text).slice(-32_768); log(text) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => { if (child.pid) runningChildren.delete(child.pid); clearTimeout(timer); if (code === 0 && !timedOut) resolve(output.trim()); else reject(new Error(timedOut ? 'Command timed out' : `Command exited with status ${code}`)) })
  })
}
export function installerArgs(id: InstallableAgent, version: string, stage: string): string[] {
  stableVersion(version)
  switch (id) {
    case 'codex': return ['--release', version]
    case 'opencode': return ['--version', version, '--no-modify-path']
    case 'gemini': return ['--dir', join(stage, 'agy')]
    default: return [version]
  }
}
export function verifyChecksum(bytes: Buffer, expected: string): void {
  if (!/^[a-f0-9]{64}$/i.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected.toLowerCase()) throw new Error('Downloaded Node checksum does not match the published checksum')
}
async function nodeRuntime(root: string, minimum: number, env: NodeJS.ProcessEnv, log: (text: string) => void): Promise<string> {
  const existing = findExecutable('node', env.HOME)
  if (existing) {
    try {
      const version = await runProcess(existing, ['--version'], env, () => {}, 5000)
      if (Number(/^v(\d+)/.exec(version)?.[1]) >= minimum) return existing
    } catch { /* provision a dedicated runtime */ }
  }
  const releases = await json('https://nodejs.org/dist/index.json') as Array<{ version: string; lts: string | false; files: string[] }>
  const arch = linuxArch(process.arch)
  const release = releases.find(r => r.lts && Number(r.version.slice(1).split('.')[0]) >= minimum && r.files.includes(`linux-${arch}`))
  if (!release) throw new Error('No compatible Node LTS release available')
  const version = stableVersion(release.version)
  const folder = `node-v${version}-linux-${arch}`
  const base = `https://nodejs.org/dist/v${version}`
  const archive = `${folder}.tar.gz`
  const checksums = (await download(`${base}/SHASUMS256.txt`)).toString()
  const checksum = checksums.split('\n').map(l => l.trim().split(/\s+/)).find(parts => parts[1] === archive)?.[0]
  if (!checksum) throw new Error('Node release checksum unavailable')
  log(`Downloading Node LTS ${version}\n`)
  const bytes = await download(`${base}/${archive}`, 150 * 1024 * 1024)
  verifyChecksum(bytes, checksum)
  await mkdir(root, { recursive: true })
  const archivePath = join(root, archive)
  await writeFile(archivePath, bytes)
  await runProcess('/usr/bin/env', ['tar', '-xzf', archivePath, '-C', root], env, log)
  return join(root, folder, 'bin/node')
}
export async function installRelease(id: InstallableAgent, release: Release, options: {
  home: string; tools: string; stage: string; log: (text: string) => void
}): Promise<string> {
  const { home, tools, stage, log } = options
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8', TERM: 'dumb', CI: '1' }
  // Preserve network settings, but never forward provider tokens into installers.
  for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) if (process.env[key]) env[key] = process.env[key]
  if (id === 'openclaude') {
    const node = await nodeRuntime(join(tools, 'node'), release.nodeMinimum ?? 22, env, log)
    const { dirname } = await import('node:path')
    env.PATH = `${dirname(node)}:${env.PATH}`
    // npm may be supplied by a system Node install separately from its binary.
    let npm = join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')
    try { await readFile(npm) } catch {
      const installed = findExecutable('npm', home)
      if (!installed) throw new Error('Node is available but npm is missing. Install npm using your distribution package manager and retry.')
      npm = installed
    }
    const prefix = join(tools, 'openclaude', release.version)
    await runProcess(node, [npm, 'install', '--global', '--prefix', prefix, `@gitlawb/openclaude@${release.version}`, '--registry=https://registry.npmjs.org', '--userconfig=/dev/null', '--no-audit', '--no-fund'], env, log)
    const entry = join(prefix, 'lib/node_modules/@gitlawb/openclaude/bin/openclaude')
    const wrapper = join(stage, 'openclaude')
    await writeFile(wrapper, `#!/bin/sh\nexport PATH=${shellQuote(dirname(node))}:"$PATH"\nexec ${shellQuote(node)} ${shellQuote(entry)} "$@"\n`, { mode: 0o700 })
    return wrapper
  }
  const source = id === 'codex' ? `https://github.com/openai/codex/releases/download/rust-v${release.version}/install.sh` : release.source
  const script = await download(source)
  if (!script.toString().startsWith('#!')) throw new Error('Official installer did not return a shell script')
  const path = join(stage, 'installer.sh')
  await writeFile(path, script, { mode: 0o600 })
  await runProcess('/bin/bash', [path, ...installerArgs(id, release.version, stage)], env, log)
  const target = id === 'gemini' ? join(stage, 'agy/agy')
    : id === 'opencode' ? join(home, '.opencode/bin/opencode')
      : id === 'grok' ? join(home, '.grok/bin/grok') : join(home, '.local/bin', id)
  await chmod(target, 0o755)
  return target
}
export async function activateStaged(source: string, destination: string): Promise<void> {
  const { dirname } = await import('node:path')
  await mkdir(dirname(destination), { recursive: true })
  const temp = `${destination}.termsprawl-new`
  await writeFile(temp, await readFile(source), { mode: 0o700 })
  await rename(temp, destination)
}
