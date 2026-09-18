// Opt-in live downloads into an isolated home; never runs during the normal suite.
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DependencyService } from './dependencies'
import { runProcess } from './dependency-installers'
import type { InstallableAgent } from '../shared/dependencies'
it.skipIf(process.env.TERMSPRAWL_INSTALL_SMOKE !== '1')('installs real agent distributions in isolated homes', async () => {
  const oldPath = process.env.PATH
  const ids = (process.env.TERMSPRAWL_INSTALL_AGENTS ?? 'openclaude,opencode').split(',') as InstallableAgent[]
  const root = await mkdtemp(join(tmpdir(), 'termsprawl-install-smoke-'))
  console.log('Isolated install smoke:', root)
  try {
    // An obsolete Node forces provisioning without touching a system runtime.
    const bin = join(root, 'bin'); await mkdir(bin)
    await writeFile(join(bin, 'node'), '#!/bin/sh\necho v18.0.0\n', { mode: 0o700 })
    process.env.PATH = `${bin}:/usr/bin:/bin`
    for (const id of ids) {
      const home = join(root, id); await mkdir(home)
      const service = new DependencyService(join(home, 'data'), { home })
      await service.install(id)
      const deadline = Date.now() + 15 * 60_000
      while (service.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500))
      console.log(id, service.job)
      expect(service.job?.state).toBe('installed')
      const status = (await service.check()).dependencies.find(d => d.id === id)!
      expect(status.state).toBe('installed'); expect(status.managed).toBe(true)
      expect(status.path?.startsWith(home)).toBe(true)
      const help = await runProcess(status.path!, ['--help'], { ...process.env, HOME: home }, () => {}, 30_000)
      expect(help.length).toBeGreaterThan(20)
    }
  } finally {
    process.env.PATH = oldPath
    if (process.env.TERMSPRAWL_KEEP_SMOKE !== '1') await rm(root, { recursive: true, force: true })
  }
}, 30 * 60_000)
