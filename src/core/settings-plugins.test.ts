import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverPlugins, pluginEnabledStates, setPluginEnabled, type PluginRoot } from './settings-plugins'

const scratch = (): { root: PluginRoot; config: string } => {
  const home = mkdtempSync(join(tmpdir(), 'ts-plugins-'))
  return {
    root: { dir: join(home, 'cache'), agent: 'codex', manifestDir: '.codex-plugin' },
    config: join(home, 'config.toml')
  }
}

const installPlugin = (
  root: PluginRoot,
  marketplace: string,
  plugin: string,
  version: string,
  manifest: Record<string, unknown>,
  extra: { skills?: number; agents?: number } = {}
): void => {
  const dir = join(root.dir, marketplace, plugin, version)
  mkdirSync(join(dir, '.codex-plugin'), { recursive: true })
  writeFileSync(join(dir, '.codex-plugin', 'plugin.json'), JSON.stringify(manifest))
  for (let i = 0; i < (extra.skills ?? 0); i++) {
    mkdirSync(join(dir, 'skills', `skill-${i}`), { recursive: true })
    writeFileSync(join(dir, 'skills', `skill-${i}`, 'SKILL.md'), '# skill')
  }
  if (extra.agents) {
    mkdirSync(join(dir, 'agents'), { recursive: true })
    for (let i = 0; i < extra.agents; i++) writeFileSync(join(dir, 'agents', `agent-${i}.md`), '# agent')
  }
}

describe('pluginEnabledStates', () => {
  it('reads the enabled flag from each plugin table', () => {
    const { config } = scratch()
    writeFileSync(
      config,
      [
        'model = "gpt-5"',
        '',
        '[plugins."browser@openai-bundled"]',
        'enabled = true',
        '',
        '[plugins."gmail@curated"]',
        'enabled = false',
        '',
        '[other]',
        'enabled = true'
      ].join('\n')
    )
    const states = pluginEnabledStates(config)
    expect(states.get('browser@openai-bundled')).toBe(true)
    expect(states.get('gmail@curated')).toBe(false)
    // A flag outside a plugins table belongs to something else.
    expect(states.has('other')).toBe(false)
  })

  it('returns nothing when the config is missing', () => {
    expect(pluginEnabledStates('/nope/config.toml').size).toBe(0)
  })
})

describe('discoverPlugins', () => {
  it('lists the newest cached version per plugin, with what it ships', () => {
    const { root, config } = scratch()
    installPlugin(root, 'curated', 'github', '0.1.8', { name: 'github', version: '0.1.8' }, { skills: 9 })
    installPlugin(root, 'curated', 'github', '0.1.10', { name: 'github', version: '0.1.10', description: 'Newest' }, { skills: 2, agents: 1 })
    writeFileSync(config, '[plugins."github@curated"]\nenabled = true\n')

    const plugins = discoverPlugins([root], config)
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({
      id: 'codex:github@curated',
      name: 'github',
      version: '0.1.10',
      description: 'Newest',
      enabled: true,
      skills: 2,
      agents: 1
    })
  })

  it('reports a cached plugin that is not enabled, and sorts enabled first', () => {
    const { root, config } = scratch()
    installPlugin(root, 'curated', 'aaa', '1.0.0', { name: 'aaa' })
    installPlugin(root, 'curated', 'zzz', '1.0.0', { name: 'zzz' })
    writeFileSync(config, '[plugins."zzz@curated"]\nenabled = true\n')
    const plugins = discoverPlugins([root], config)
    expect(plugins.map((p) => [p.name, p.enabled])).toEqual([
      ['zzz', true],
      ['aaa', false]
    ])
  })

  it('ignores directories without a manifest and roots that do not exist', () => {
    const { root, config } = scratch()
    mkdirSync(join(root.dir, 'curated', 'broken', '1.0.0'), { recursive: true })
    expect(discoverPlugins([root], config)).toEqual([])
    expect(discoverPlugins([{ dir: '/nope', agent: 'codex', manifestDir: '.codex-plugin' }], config)).toEqual([])
  })
})

describe('setPluginEnabled', () => {
  it('flips an existing flag and leaves the rest of the file alone', () => {
    const { config } = scratch()
    writeFileSync(config, 'model = "gpt-5"\n\n[plugins."a@m"]\nenabled = true\n\n[hooks]\nfoo = "bar"\n')
    setPluginEnabled(config, 'a@m', false)
    expect(readFileSync(config, 'utf8')).toBe('model = "gpt-5"\n\n[plugins."a@m"]\nenabled = false\n\n[hooks]\nfoo = "bar"\n')
  })

  it('appends a table for a plugin the config never mentioned', () => {
    const { config } = scratch()
    writeFileSync(config, 'model = "gpt-5"\n')
    setPluginEnabled(config, 'new@m', true)
    expect(readFileSync(config, 'utf8')).toBe('model = "gpt-5"\n\n[plugins."new@m"]\nenabled = true\n')
    expect(pluginEnabledStates(config).get('new@m')).toBe(true)
  })

  it('adds the flag to a table that exists without one', () => {
    const { config } = scratch()
    writeFileSync(config, '[plugins."a@m"]\nversion = "1"\n\n[next]\n')
    setPluginEnabled(config, 'a@m', true)
    // The flag goes directly under the table header, before its other keys.
    expect(readFileSync(config, 'utf8')).toBe('[plugins."a@m"]\nenabled = true\nversion = "1"\n\n[next]\n')
  })

  it('creates the config file when it does not exist yet', () => {
    const { config } = scratch()
    setPluginEnabled(config, 'a@m', true)
    expect(readFileSync(config, 'utf8')).toBe('\n[plugins."a@m"]\nenabled = true\n')
  })
})
