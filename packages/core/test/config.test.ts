import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configSearchPaths, defaultConfigPath, loadConfig, PACKAGE_ROOT } from '../src/config.ts'

const minimal = {
  upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1' } },
  models: { cheap: { upstream: 'mock', model: 'm-cheap' } },
  aliases: { 'sabi-code': 'auto' },
  policy: { unclassified: 'cheap' },
}

function workspace(): { root: string; home: string; pkg: string; project: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabi-config-'))
  const home = path.join(root, 'home')
  const pkg = path.join(root, 'clone', 'packages', 'core')
  const project = path.join(root, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(pkg, { recursive: true })
  mkdirSync(project, { recursive: true })
  return { root, home, pkg, project }
}

function write(file: string, config: unknown = minimal): string {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2))
  return file
}

test('$SABI_CONFIG is the only candidate when it is set', () => {
  const { project, home, pkg } = workspace()
  const paths = configSearchPaths({ cwd: project, packageRoot: pkg, env: { SABI_CONFIG: '/tmp/chosen.json' } })
  assert.deepEqual(paths, ['/tmp/chosen.json'])
  assert.equal(defaultConfigPath({ cwd: project, packageRoot: pkg, env: { SABI_CONFIG: '/tmp/chosen.json' } }), '/tmp/chosen.json')
  assert.ok(home)
})

test('the working directory wins over the user config and the installed package', () => {
  const { home, pkg, project } = workspace()
  const own = write(path.join(project, 'sabi.config.json'))
  write(path.join(home, 'sabi', 'sabi.config.json'))
  write(path.join(pkg, '..', '..', 'sabi.config.json'))
  const options = { cwd: project, packageRoot: pkg, env: { XDG_CONFIG_HOME: home } }
  assert.equal(defaultConfigPath(options), own)
  assert.equal(configSearchPaths(options)[0], own)
})

test('the user config wins over the config shipped with the package', () => {
  const { home, pkg, project } = workspace()
  const user = write(path.join(home, 'sabi', 'sabi.config.json'))
  write(path.join(pkg, '..', '..', 'sabi.config.json'))
  const options = { cwd: project, packageRoot: pkg, env: { XDG_CONFIG_HOME: home } }
  assert.equal(defaultConfigPath(options), user)
})

test('without a cwd or user config, the nearest config above the package is used', () => {
  const { home, pkg, project } = workspace()
  const shipped = write(path.join(pkg, '..', '..', 'sabi.config.json'))
  const options = { cwd: project, packageRoot: pkg, env: { XDG_CONFIG_HOME: home } }
  assert.equal(defaultConfigPath(options), shipped)
})

test('when nothing exists the search still reports where a config would go', () => {
  const { home, pkg, project } = workspace()
  const options = { cwd: project, packageRoot: pkg, env: { XDG_CONFIG_HOME: home } }
  assert.deepEqual(configSearchPaths(options), [
    path.join(project, 'sabi.config.json'),
    path.join(home, 'sabi', 'sabi.config.json'),
  ])
  assert.equal(defaultConfigPath(options), path.join(project, 'sabi.config.json'))
})

test('loadConfig reads the file it resolves and rejects a missing one with a hint', () => {
  const { home, pkg, project } = workspace()
  const own = write(path.join(project, 'sabi.config.json'))
  assert.equal(loadConfig(own).aliases['sabi-code'], 'auto')
  assert.throws(
    () => loadConfig(path.join(project, 'nope.config.json')),
    /Sabi config not found at .*nope\.config\.json/,
  )
})

test('the default package root is the directory that ships this package', () => {
  assert.equal(path.basename(PACKAGE_ROOT), 'core')
  assert.equal(path.basename(path.dirname(PACKAGE_ROOT)), 'packages')
})
