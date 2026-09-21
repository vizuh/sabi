import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  configSearchPaths,
  defaultConfigPath,
  loadConfig,
  loadConfiguredSecrets,
  PACKAGE_ROOT,
  parseEnvFile,
  secretSearchPaths,
  validateConfig,
} from '../src/config.ts'

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

test('parseEnvFile reads dotenv assignments without evaluating shell code', () => {
  assert.deepEqual(parseEnvFile([
    '# ignored',
    'export OPENROUTER_API_KEY="router-value"',
    'typesafe=jev-value # inline comment',
    'EMPTY=',
    'not an assignment',
  ].join('\n')), {
    OPENROUTER_API_KEY: 'router-value',
    typesafe: 'jev-value',
    EMPTY: '',
  })
})

test('workspace secret discovery loads only configured keys and preserves shell precedence', () => {
  const { root, project, pkg } = workspace()
  const file = path.join(root, 'secrets', '.env')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, 'OPENROUTER_API_KEY=file-router\ntypesafe=file-jev\nUNRELATED=do-not-load\n')
  const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'shell-router' }
  const config = validateConfig({
    upstreams: {
      openrouter: { baseURL: 'http://127.0.0.1:1/v1', apiKey: '$OPENROUTER_API_KEY' },
      ollama: { baseURL: 'http://127.0.0.1:2/v1', apiKey: false },
    },
    models: { cheap: { upstream: 'openrouter', model: 'm-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
    judge: { enabled: true, baseURL: 'http://127.0.0.1:3/v1', apiKey: '$TYPESAFE_API_KEY' },
  })

  const result = loadConfiguredSecrets(config, { cwd: project, packageRoot: pkg, env })
  assert.equal(result.file, file)
  assert.deepEqual(result.loaded, ['TYPESAFE_API_KEY'])
  assert.equal(env.OPENROUTER_API_KEY, 'shell-router')
  assert.equal(env.TYPESAFE_API_KEY, 'file-jev')
  assert.equal(env.UNRELATED, undefined)
})

test('explicit SABI_SECRETS_FILE wins over the nearest workspace file', () => {
  const { root, project, pkg } = workspace()
  const workspaceFile = path.join(root, 'secrets', '.env')
  const explicitFile = path.join(root, 'private', 'credentials.env')
  mkdirSync(path.dirname(workspaceFile), { recursive: true })
  mkdirSync(path.dirname(explicitFile), { recursive: true })
  writeFileSync(workspaceFile, 'OPENROUTER_API_KEY=workspace\n')
  writeFileSync(explicitFile, 'OPENROUTER_API_KEY=explicit\n')
  const env: NodeJS.ProcessEnv = { SABI_SECRETS_FILE: explicitFile }
  const paths = secretSearchPaths({ cwd: project, packageRoot: pkg, env })
  assert.deepEqual(paths, [explicitFile])
  const config = validateConfig({
    upstreams: { openrouter: { baseURL: 'http://127.0.0.1:1/v1', apiKey: '$OPENROUTER_API_KEY' } },
    models: { cheap: { upstream: 'openrouter', model: 'm-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
  })
  assert.deepEqual(loadConfiguredSecrets(config, { cwd: project, packageRoot: pkg, env }).loaded, ['OPENROUTER_API_KEY'])
  assert.equal(env.OPENROUTER_API_KEY, 'explicit')
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

test('controller harness model preferences are validated', () => {
  assert.doesNotThrow(() => validateConfig({
    ...minimal,
    controller: {
      preferredHarnesses: ['opencode', 'command-code'],
      harnesses: { opencode: { preferredModels: ['opencode-go/kimi-k3'] } },
    },
  }))
  assert.throws(() => validateConfig({ ...minimal, controller: { preferredHarnesses: ['opencode', 'opencode'] } }), /must not contain duplicates/)
  assert.throws(() => validateConfig({ ...minimal, controller: { harnesses: { opencode: { preferredModels: [''] } } } }), /preferredModels/)
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

test('upstream.enabled is an optional boolean kill switch that never blocks config validation', () => {
  assert.doesNotThrow(() => validateConfig({ ...minimal, upstreams: { mock: { ...minimal.upstreams.mock, enabled: true } } }))
  const disabled = validateConfig({ ...minimal, upstreams: { mock: { ...minimal.upstreams.mock, enabled: false } } })
  assert.equal(disabled.upstreams.mock!.enabled, false)
  assert.equal(disabled.models.cheap!.upstream, 'mock', 'a model/alias targeting a disabled upstream still loads')
  for (const enabled of ['no', 1, null, []]) {
    assert.throws(
      () => validateConfig({ ...minimal, upstreams: { mock: { ...minimal.upstreams.mock, enabled } } }),
      /enabled/,
    )
  }
})

test('model and policy dictionaries cannot resolve inherited properties', () => {
  assert.throws(() => validateConfig({ ...minimal, aliases: { bad: 'toString' } }), /unknown tier/)
  assert.throws(() => validateConfig({ ...minimal, policy: { unclassified: 'constructor' } }), /unknown tier/)
  assert.throws(() => validateConfig({ ...minimal, models: [] }), /models must be an object/)
})

test('unknown policy rule names are rejected at load time', () => {
  assert.throws(
    () => validateConfig({ ...minimal, policy: { failur: 'cheap', unclassified: 'cheap' } }),
    /not a known rule/,
  )
  assert.doesNotThrow(() => validateConfig(minimal))
})

test('judge.callOn values must name known policy rules', () => {
  const judge = { enabled: true, baseURL: 'http://127.0.0.1:1/v1', callOn: ['failure', 'unclassified'] }
  assert.doesNotThrow(() => validateConfig({ ...minimal, judge }))
  assert.throws(
    () => validateConfig({ ...minimal, judge: { ...judge, callOn: ['failur'] } }),
    /judge\.callOn rule 'failur' is not a known rule/,
  )
})

test('an auto alias requires the effective fallback tier to exist at load time', () => {
  const tiers = {
    alpha: { upstream: 'mock', model: 'm-alpha' },
    beta: { upstream: 'mock', model: 'm-beta' },
  }
  // No `unclassified` and no literal `cheap`: an adaptive alias would 500 the first
  // unmatched round, so validation fails before any request.
  assert.throws(
    () => validateConfig({
      upstreams: minimal.upstreams,
      models: tiers,
      aliases: { 'sabi-code': 'auto' },
      policy: { exploration: 'alpha' },
    }),
    /policy\.unclassified must resolve/,
  )
  assert.doesNotThrow(() => validateConfig({
    upstreams: minimal.upstreams,
    models: tiers,
    aliases: { 'sabi-code': 'auto' },
    policy: { exploration: 'alpha', unclassified: 'beta' },
  }))
  // Fixed-alias-only configs never take the adaptive fallback path.
  assert.doesNotThrow(() => validateConfig({
    upstreams: minimal.upstreams,
    models: tiers,
    aliases: { 'sabi-fixed': 'alpha' },
    policy: { exploration: 'alpha' },
  }))
})

test('harness tier modalities and windows are validated', () => {
  const base = {
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1' } },
    models: { cheap: { upstream: 'mock', model: 'm-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
  }
  assert.doesNotThrow(() => validateConfig({
    ...base, harness: { tiers: { cheap: { model: 'm', inputModalities: ['text', 'image'], contextWindow: 1000 } } },
  }))
  for (const tiers of [
    { cheap: { model: 'm', inputModalities: ['imgae'] } },
    { cheap: { model: 'm', inputModalities: [] } },
    { cheap: { model: 'm', inputModalities: ['text', 'text'] } },
    { cheap: { model: 'm', inputModalities: 'text' } },
  ]) {
    assert.throws(() => validateConfig({ ...base, harness: { tiers } }), /inputModalities/)
  }
  for (const tiers of [
    { cheap: { model: 'm', contextWindow: 0 } },
    { cheap: { model: 'm', contextWindow: -5 } },
    { cheap: { model: 'm', contextWindow: 1.5 } },
    { cheap: { model: 'm', contextWindow: 'big' } },
  ]) {
    assert.throws(() => validateConfig({ ...base, harness: { tiers } }), /contextWindow/)
  }
})

test('an empty declared modality list is rejected', () => {
  assert.throws(
    () => validateConfig({
      ...minimal,
      models: { cheap: { ...minimal.models.cheap, capabilities: { inputModalities: [] } } },
    }),
    /must not be empty/,
  )
  assert.throws(
    () => validateConfig({
      ...minimal,
      models: { cheap: { ...minimal.models.cheap, capabilities: { outputModalities: [] } } },
    }),
    /must not be empty/,
  )
})

test('workspace secret search stops at the containing .git boundary', () => {
  const { root, project } = workspace()
  const repo = path.join(root, 'repo')
  const sub = path.join(repo, 'nested', 'deep')
  mkdirSync(sub, { recursive: true })
  mkdirSync(path.join(repo, '.git'))
  const outside = path.join(root, 'secrets', '.env')
  mkdirSync(path.dirname(outside), { recursive: true })
  writeFileSync(outside, 'OPENROUTER_API_KEY=outside\n')
  const env: NodeJS.ProcessEnv = {}
  const paths = secretSearchPaths({ cwd: sub, packageRoot: sub, env })
  assert.ok(!paths.includes(outside), `search climbed above the repo root: ${paths.join(', ')}`)
  const inside = path.join(repo, 'secrets', '.env')
  mkdirSync(path.dirname(inside), { recursive: true })
  writeFileSync(inside, 'OPENROUTER_API_KEY=inside\n')
  const found = secretSearchPaths({ cwd: sub, packageRoot: sub, env })
  assert.ok(found.includes(inside), `expected the repo-local secrets file: ${found.join(', ')}`)
  assert.ok(!found.includes(outside))
  assert.ok(project)
})

test('secret loading without install never touches the live process environment', () => {
  const key = 'SABI_TEST_EPHEMERAL_KEY_65_75'
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-secrets-dry-'))
  const file = path.join(dir, 'credentials.env')
  writeFileSync(file, `${key}=file-value\n`)
  const previousFile = process.env.SABI_SECRETS_FILE
  const previousValue = process.env[key]
  try {
    process.env.SABI_SECRETS_FILE = file
    delete process.env[key]
    const config = validateConfig({
      upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: `$${key}` } },
      models: { cheap: { upstream: 'mock', model: 'm-cheap' } },
      aliases: { 'sabi-code': 'auto' },
      policy: { unclassified: 'cheap' },
    })
    const dry = loadConfiguredSecrets(config)
    assert.deepEqual(dry.loaded, [key], 'dry run still reports the satisfiable key')
    assert.equal(process.env[key], undefined, 'dry run must not install into process.env')
    const installed = loadConfiguredSecrets(config, { install: true })
    assert.deepEqual(installed.loaded, [key])
    assert.equal(process.env[key], 'file-value', 'explicit install:true performs the documented side effect')
    assert.ok(!String(installed.file).includes('file-value') && !installed.loaded.includes('file-value'))
  } finally {
    if (previousFile === undefined) delete process.env.SABI_SECRETS_FILE
    else process.env.SABI_SECRETS_FILE = previousFile
    if (previousValue === undefined) delete process.env[key]
    else process.env[key] = previousValue
  }
})

test('judge.includeSnippets is an optional boolean egress opt-in', () => {
  const judge = { enabled: true, baseURL: 'http://127.0.0.1:3/v1' }
  assert.equal(validateConfig({ ...minimal, judge: { ...judge, includeSnippets: true } }).judge!.includeSnippets, true)
  assert.equal(validateConfig({ ...minimal, judge }).judge!.includeSnippets, undefined)
  assert.throws(
    () => validateConfig({ ...minimal, judge: { ...judge, includeSnippets: 'yes' } }),
    /judge\.includeSnippets must be a boolean/,
  )
})
