import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configSearchPaths, defaultConfigPath, loadConfig, PACKAGE_ROOT, validateConfig } from '../src/config.ts'

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

test('harness.tiers is validated as an independent routing catalog', () => {
  const base = {
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1' } },
    models: { cheap: { upstream: 'mock', model: 'm-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
  }
  assert.doesNotThrow(() => validateConfig({ ...base, harness: { tiers: { cheap: { model: 'm', effort: 'high' } } } }))
  assert.throws(
    () => validateConfig({ ...base, harness: { tiers: { cheap: {} } } }),
    /harness\.tiers\.cheap must declare a model id/,
  )
  assert.throws(
    () => validateConfig({ ...base, harness: { tiers: 'nope' } }),
    /harness\.tiers must be an object/,
  )
})

test('telemetry config is validated', () => {
  const base = {
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1' } },
    models: { cheap: { upstream: 'mock', model: 'm-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
  }
  assert.doesNotThrow(() => validateConfig({ ...base, telemetry: { allowlistOnly: true, captureChars: 400 } }))
  assert.throws(() => validateConfig({ ...base, telemetry: { captureChars: -1 } }), /captureChars/)
})


test('compatibility mode is explicit and strict metadata omissions remain unknown until a route is checked', () => {
  assert.equal(validateConfig(minimal).compatibility, undefined)
  assert.equal(validateConfig({ ...minimal, compatibility: { mode: 'strict' } }).compatibility?.mode, 'strict')
  assert.equal(validateConfig({ ...minimal, compatibility: { mode: 'legacy' } }).compatibility?.mode, 'legacy')
  for (const compatibility of [null, [], {}, { mode: 'yes' }, { mode: 'strict', silentFallback: true }]) {
    assert.throws(() => validateConfig({ ...minimal, compatibility }), /compatibility/)
  }
})

test('model limits, capabilities and operator-supplied context assumptions are validated', () => {
  const metadata = {
    contextWindow: 10000, maxOutputTokens: 1000,
    capabilities: {
      tools: true, parallelTools: true, strictTools: false,
      inputModalities: ['text', 'image'], outputModalities: ['text'],
      structuredOutput: ['json_schema'], reasoningEfforts: ['high'], supportedParameters: ['tools', 'max_tokens'],
    },
    contextAccounting: { textTokensPerByte: 1, requestOverheadTokens: 0, perMessageOverheadTokens: 2, mediaTokens: { image: 100 } },
  }
  const withMetadata = (patch: Record<string, unknown>) => ({
    ...minimal, models: { cheap: { ...minimal.models.cheap, ...metadata, ...patch } },
  })
  assert.doesNotThrow(() => validateConfig(withMetadata({})))
  for (const field of ['contextWindow', 'maxOutputTokens']) {
    for (const bad of [-1, 0, 1.5, Infinity, NaN, '100', null]) {
      assert.throws(() => validateConfig(withMetadata({ [field]: bad })), new RegExp(field))
    }
  }
  assert.throws(() => validateConfig(withMetadata({ maxOutputTokens: 10001 })), /cannot exceed contextWindow/)
  for (const capabilities of [
    false, [], { tools: 'yes' }, { inputModalities: ['unknown'] }, { outputModalities: ['text', 'text'] },
    { structuredOutput: ['yaml'] }, { reasoningEfforts: 'high' }, { supportedParameters: [''] },
    { typoTools: true }, { tools: false, parallelTools: true },
  ]) assert.throws(() => validateConfig(withMetadata({ capabilities })), /capabilities/)
  for (const contextAccounting of [
    null, {}, { ...metadata.contextAccounting, textTokensPerByte: NaN },
    { ...metadata.contextAccounting, textTokensPerByte: 0 },
    { ...metadata.contextAccounting, requestOverheadTokens: -1 },
    { ...metadata.contextAccounting, perMessageOverheadTokens: 0.1 },
    { ...metadata.contextAccounting, mediaTokens: { image: 0 } },
    { ...metadata.contextAccounting, mediaTokens: { speech: 100 } },
    { ...metadata.contextAccounting, typo: 5 },
  ]) assert.throws(() => validateConfig(withMetadata({ contextAccounting })), /contextAccounting/)
})

test('unknown price stays absent and invalid numeric rates never become free', () => {
  assert.equal(validateConfig(minimal).models.cheap!.cost, undefined)
  for (const cost of [{ input: NaN, output: 1 }, { input: 1, output: Infinity }, { input: -1, output: 1 }, { input: 1 }, { input: 1, output: 1, cacheRead: -1 }]) {
    assert.throws(() => validateConfig({ ...minimal, models: { cheap: { ...minimal.models.cheap, cost } } }), /cost/)
  }
  assert.doesNotThrow(() => validateConfig({ ...minimal, models: { cheap: { ...minimal.models.cheap, cost: { input: 0, output: 0 } } } }))
})

test('model and policy dictionaries cannot resolve inherited properties', () => {
  assert.throws(() => validateConfig({ ...minimal, aliases: { bad: 'toString' } }), /unknown tier/)
  assert.throws(() => validateConfig({ ...minimal, policy: { unclassified: 'constructor' } }), /unknown tier/)
  assert.throws(() => validateConfig({ ...minimal, models: [] }), /models must be an object/)
})
