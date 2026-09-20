import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isFreeTier, isFreeUpstream, minContextWindow, resolveConsent } from '../src/connect.ts'
import { isEnabledUpstream, tiersFor, type SabiConfig } from '@sabi/core'

const connectPath = fileURLToPath(new URL('../src/connect.ts', import.meta.url))

function baseConfig(patch: Record<string, unknown> = {}): SabiConfig {
  return {
    upstreams: {
      paid: { baseURL: 'http://127.0.0.1:1/v1', apiKey: '$FAKE_KEY' },
      local: { baseURL: 'http://127.0.0.1:2/v1', apiKey: false },
    },
    models: {
      cheap: { upstream: 'paid', model: 'p-cheap', contextWindow: 1000 },
      strong: { upstream: 'paid', model: 'p-strong', contextWindow: 2000 },
      local: { upstream: 'local', model: 'l-local', contextWindow: 500 },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap', 'sabi-local': 'local' },
    policy: { unclassified: 'cheap', failure: 'strong' },
    ...patch,
  } as SabiConfig
}

// --- Unit tests: pure decision functions, no subprocess ---

test('resolveConsent: flags win outright regardless of TTY', () => {
  assert.equal(resolveConsent(['--paid'], true), 'paid')
  assert.equal(resolveConsent(['--paid'], false), 'paid')
  assert.equal(resolveConsent(['--free'], true), 'free')
  assert.equal(resolveConsent(['--free'], false), 'free')
})

test('resolveConsent: no flags defaults to free when non-interactive, prompts on a real TTY', () => {
  assert.equal(resolveConsent([], false), 'free')
  assert.equal(resolveConsent([], true), 'prompt')
})

// tiersFor() itself is core's contract (packages/core); these just confirm connect.ts's usable
// filter composes correctly with whatever it returns for the cases that matter here.
test('tiersFor: a fixed target resolves to itself', () => {
  const config = baseConfig()
  assert.deepEqual(tiersFor(config, 'cheap'), ['cheap'])
})

test('tiersFor: auto expands through policy, deduped, "off" excluded', () => {
  const config = baseConfig({ policy: { unclassified: 'cheap', failure: 'strong', stuck: 'strong', off: 'off' } })
  assert.deepEqual(new Set(tiersFor(config, 'auto')), new Set(['cheap', 'strong']))
})

test('tiersFor: auto falls back to every model when policy is empty', () => {
  const config = baseConfig({ policy: {} })
  assert.deepEqual(new Set(tiersFor(config, 'auto')), new Set(['cheap', 'strong', 'local']))
})

test('isEnabledUpstream / isFreeUpstream truth table', () => {
  assert.equal(isEnabledUpstream(undefined), false)
  assert.equal(isEnabledUpstream({ baseURL: 'x' }), true)
  assert.equal(isEnabledUpstream({ baseURL: 'x', enabled: true }), true)
  assert.equal(isEnabledUpstream({ baseURL: 'x', enabled: false }), false)
  assert.equal(isFreeUpstream({ baseURL: 'x', apiKey: false }), true)
  assert.equal(isFreeUpstream({ baseURL: 'x', apiKey: '$X' }), false)
  assert.equal(isFreeUpstream(undefined), false)
})

test('explicit zero-priced model is free even when its OpenRouter upstream needs a key', () => {
  const config = baseConfig({
    models: {
      cheap: { upstream: 'paid', model: 'p-cheap', contextWindow: 1000 },
      strong: { upstream: 'paid', model: 'p-strong', contextWindow: 2000 },
      quality: { upstream: 'paid', model: 'p-free', contextWindow: 3000, cost: { input: 0, output: 0 } },
      local: { upstream: 'local', model: 'l-local', contextWindow: 500 },
    },
  })
  assert.equal(isFreeTier(config, 'quality'), true)
  assert.equal(isFreeTier(config, 'cheap'), false)
})

test('minContextWindow: smallest window among the given tiers, undefined when none declare one', () => {
  const config = baseConfig()
  assert.equal(minContextWindow(config, ['cheap', 'strong']), 1000)
  assert.equal(minContextWindow(config, []), undefined)
  assert.equal(minContextWindow(baseConfig({ models: { cheap: { upstream: 'paid', model: 'p' } } }), ['cheap']), undefined)
})

// --- Integration tests: spawn the real script, piped stdio (non-TTY, never prompts) ---

function run(args: string[], config: SabiConfig, providers: Record<string, unknown> = { provider: {} }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-connect-'))
  const configPath = path.join(dir, 'sabi.config.json')
  const providersPath = path.join(dir, 'providers.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  writeFileSync(providersPath, JSON.stringify(providers, null, 2))
  const result = spawnSync('node', [connectPath, ...args], {
    env: { ...process.env, SABI_CONFIG: configPath, SABI_CC_PROVIDERS: providersPath },
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  const written = existsSync(providersPath) ? JSON.parse(readFileSync(providersPath, 'utf8')) : undefined
  return { ...result, providersPath, written }
}

test('no flags, non-interactive: nothing paid registers, points at the Class A mod', () => {
  const { status, stdout, written } = run([], baseConfig())
  assert.equal(status, 0)
  assert.deepEqual(written.provider.sabi.models, {})
  assert.match(stdout, /Use the Class A mod/)
})

test('--paid registers every alias reachable from an enabled paid upstream', () => {
  const { status, written } = run(['--paid'], baseConfig())
  assert.equal(status, 0)
  assert.deepEqual(Object.keys(written.provider.sabi.models).sort(), ['sabi-cheap', 'sabi-code'])
})

test('--paid --include-local also registers the local/free-only alias', () => {
  const { status, written } = run(['--paid', '--include-local'], baseConfig())
  assert.equal(status, 0)
  assert.deepEqual(Object.keys(written.provider.sabi.models).sort(), ['sabi-cheap', 'sabi-code', 'sabi-local'])
})

test('a disabled upstream overrides --paid: its aliases never register', () => {
  const config = baseConfig({ upstreams: { paid: { baseURL: 'http://127.0.0.1:1/v1', apiKey: '$FAKE_KEY', enabled: false }, local: { baseURL: 'http://127.0.0.1:2/v1', apiKey: false } } })
  const { status, written } = run(['--paid', '--include-local'], config)
  assert.equal(status, 0)
  assert.deepEqual(Object.keys(written.provider.sabi.models).sort(), ['sabi-local'])
})

test('--free explicitly skips paid upstreams the same as no flags', () => {
  const { status, written } = run(['--free'], baseConfig())
  assert.equal(status, 0)
  assert.deepEqual(written.provider.sabi.models, {})
})

test('--free registers a fixed zero-priced quality lane but not an adaptive alias that can reach paid tiers', () => {
  const config = baseConfig({
    models: {
      cheap: { upstream: 'paid', model: 'p-cheap', contextWindow: 1000 },
      strong: { upstream: 'paid', model: 'p-strong', contextWindow: 2000 },
      quality: { upstream: 'paid', model: 'p-free', contextWindow: 3000, cost: { input: 0, output: 0 } },
      local: { upstream: 'local', model: 'l-local', contextWindow: 500 },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-quality': 'quality', 'sabi-local': 'local' },
    policy: { unclassified: 'cheap', failure: 'strong', verification: 'quality' },
  })
  const { status, written } = run(['--free'], config)
  assert.equal(status, 0)
  assert.deepEqual(Object.keys(written.provider.sabi.models), ['sabi-quality'])
})

test('an unrelated existing provider entry survives the run', () => {
  const { status, written } = run(['--paid'], baseConfig(), { provider: { 'other-tool': { name: 'Other' } } })
  assert.equal(status, 0)
  assert.deepEqual(written.provider['other-tool'], { name: 'Other' })
  assert.ok(written.provider.sabi)
})

test('malformed providers.json is refused: non-zero exit, file left untouched', () => {
  const dir = mktempWithMalformedProviders()
  const configPath = path.join(dir, 'sabi.config.json')
  writeFileSync(configPath, JSON.stringify(baseConfig(), null, 2))
  const providersPath = path.join(dir, 'providers.json')
  const before = readFileSync(providersPath, 'utf8')
  const result = spawnSync('node', [connectPath, '--paid'], {
    env: { ...process.env, SABI_CONFIG: configPath, SABI_CC_PROVIDERS: providersPath },
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(providersPath, 'utf8'), before)
})

function mktempWithMalformedProviders(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-connect-'))
  writeFileSync(path.join(dir, 'providers.json'), '{ not json')
  return dir
}
