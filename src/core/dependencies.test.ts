import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DependencyService, newerVersion, systemInstallCommand } from './dependencies'
import { installerArgs, linuxArch, stableVersion, verifyChecksum, runProcess, download } from './dependency-installers'
import { commandCandidates, findExecutable } from './command-resolver'
const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'termsprawl-setup-test-')); roots.push(home)
  vi.stubEnv('PATH', '/usr/bin:/bin')
  return { home, data: join(home, 'data') }
}
async function binary(path: string, version = '1.2.3', mode = 0o700) {
  await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `#!/bin/sh\necho ${version}\n`, { mode })
}
async function finished(service: DependencyService) {
  await vi.waitFor(() => expect(service.busy).toBe(false), { timeout: 5000 })
  // Job completion is published before the atomic manifest write finishes.
  await vi.waitFor(async () => expect(JSON.parse(await readFile(join(service.tools, '../dependencies.json'), 'utf8')).job.state).not.toBe('installing'))
  return service.job!
}
const release = async () => ({ version: '1.2.3', source: 'https://example.test/release' })
describe('dependency setup', () => {
  it('resolves vendor paths without shell startup files and rejects non-executable files', async () => {
    const { home } = await fixture()
    await binary(join(home, '.opencode/bin/opencode'))
    await binary(join(home, '.grok/bin/grok'), '1.2.3', 0o600)
    expect(findExecutable('opencode', home)).toBe(join(home, '.opencode/bin/opencode'))
    expect(findExecutable('grok', home)).toBeNull()
    expect(commandCandidates('grok', home)).toContain(join(home, '.grok/bin/grok'))
  })
  it('reports incompatible tools without overwriting them', async () => {
    const { home, data } = await fixture()
    const path = join(home, '.opencode/bin/opencode'); await binary(path, '1.0.0', 0o600)
    const installer = vi.fn()
    const service = new DependencyService(data, { home, installer, resolveRelease: release })
    expect((await service.check()).dependencies.find(d => d.id === 'opencode')?.state).toBe('incompatible')
    await service.install('opencode'); expect((await finished(service)).error).toMatch(/external installation/)
    expect(installer).not.toHaveBeenCalled(); expect(await readFile(path, 'utf8')).toContain('1.0.0')
  })
  it('locks before asynchronous work, verifies installs, persists ownership, and permits managed updates', async () => {
    const { home, data } = await fixture()
    const installer = vi.fn(async (_id, _release, options) => {
      const path = join(options.stage, 'openclaude'); await binary(path); return path
    })
    const service = new DependencyService(data, { home, installer, resolveRelease: release })
    const start = service.install('openclaude')
    await expect(service.install('opencode')).rejects.toThrow('already running')
    await start
    expect((await finished(service)).state).toBe('installed')
    const next = new DependencyService(data, { home, installer, resolveRelease: release })
    const tool = (await next.check()).dependencies.find(d => d.id === 'openclaude')!
    expect(tool).toMatchObject({ state: 'installed', version: '1.2.3', managed: true })
    await next.install('openclaude'); expect((await finished(next)).state).toBe('installed')
  })
  it('keeps a failed job retryable and logs bounded', async () => {
    const { home, data } = await fixture()
    let fail = true
    const service = new DependencyService(data, { home, resolveRelease: release, installer: async (_id, _r, options) => {
      options.log('x'.repeat(50_000))
      if (fail) throw new Error('Download failed')
      const path = join(options.stage, 'openclaude'); await binary(path); return path
    } })
    await service.install('openclaude'); expect((await finished(service)).state).toBe('failed')
    expect(service.job!.logs.length).toBeLessThanOrEqual(32_768)
    fail = false; await service.install('openclaude'); expect((await finished(service)).state).toBe('installed')
  })
  it('does not activate a downloaded binary with the wrong version', async () => {
    const { home, data } = await fixture()
    const service = new DependencyService(data, { home, resolveRelease: release, installer: async (_id, _r, options) => {
      const path = join(options.stage, 'openclaude'); await binary(path, '9.9.9'); return path
    } })
    await service.install('openclaude'); expect((await finished(service)).error).toMatch(/Version verification failed/)
    expect(findExecutable('openclaude', home)).toBeNull()
  })
  it('refuses active-agent updates and unknown installer IDs', async () => {
    const { home, data } = await fixture()
    const installer = vi.fn()
    const service = new DependencyService(data, { home, installer, resolveRelease: release, active: () => true })
    await service.install('openclaude'); expect((await finished(service)).error).toMatch(/Close this agent/)
    await expect(service.install('bad' as never)).rejects.toThrow('Unknown installer')
    expect(installer).not.toHaveBeenCalled()
  })
  it('preserves installed status when release lookup is offline', { timeout: 20_000 }, async () => {
    const { home, data } = await fixture(); await binary(join(home, '.opencode/bin/opencode'))
    const service = new DependencyService(data, { home, resolveRelease: async () => { throw new Error('offline') } })
    const result = await service.checkUpdates()
    expect(result.dependencies.find(d => d.id === 'opencode')).toMatchObject({ state: 'installed', updateError: 'offline' })
  })
  it('marks interrupted jobs failed on restart', async () => {
    const { home, data } = await fixture(); await mkdir(data)
    await writeFile(join(data, 'dependencies.json'), JSON.stringify({ installations: {}, job: { state: 'installing', agent: 'codex' } }))
    expect(new DependencyService(data, { home }).job).toMatchObject({ state: 'failed', phase: 'Interrupted' })
  })
  it('times out a stuck executable without hanging the app', async () => {
    await expect(runProcess('/bin/sh', ['-c', 'sleep 30'], process.env, () => {}, 30)).rejects.toThrow('timed out')
  })
})
describe('installer policy', () => {
  it('uses fixed arguments and excludes prereleases', () => {
    expect(installerArgs('opencode', '1.2.3', '/tmp/stage')).toEqual(['--version', '1.2.3', '--no-modify-path'])
    expect(installerArgs('codex', '1.2.3', '/tmp/stage')).toEqual(['--release', '1.2.3'])
    expect(() => stableVersion('1.2.3-beta.1')).toThrow()
    expect(() => stableVersion('1.2.3; rm -rf /')).toThrow()
    expect(linuxArch('arm64')).toBe('arm64'); expect(() => linuxArch('ia32')).toThrow()
  })
  it('checks the exact downloaded Node bytes', () => {
    const bytes = Buffer.from('node archive'), hash = createHash('sha256').update(bytes).digest('hex')
    expect(() => verifyChecksum(bytes, hash)).not.toThrow()
    expect(() => verifyChecksum(Buffer.from('wrong'), hash)).toThrow('checksum')
  })
  it('handles versions numerically', () => { expect(newerVersion('1.10.0', '1.9.0')).toBe(true); expect(newerVersion('1.2.0', '2.0.0')).toBe(false) })
  it('offers distro commands containing only catalog packages', () => {
    expect(systemInstallCommand('ID=ubuntu\nID_LIKE=debian', ['tmux', 'git', 'evil;command'])).toBe('sudo apt-get update && sudo apt-get install -- tmux git')
    expect(systemInstallCommand('ID=arch', ['git'])).toContain('pacman')
    expect(systemInstallCommand('ID=fedora', ['git'])).toContain('dnf')
    expect(systemInstallCommand('ID=opensuse-tumbleweed', ['git'])).toContain('zypper')
    expect(systemInstallCommand('ID=unknown', ['git'])).toBeNull()
  })
  it('rejects failed HTTP downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    await expect(download('https://example.test/installer')).rejects.toThrow('HTTP 503')
    vi.unstubAllGlobals()
  })
})
