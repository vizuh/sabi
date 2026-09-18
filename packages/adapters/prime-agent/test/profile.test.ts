import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeEnvironment, probeRoot, probeSettings, probeModels, mockSabiConfig, probeVariants } from '../src/profile.ts'
import { route } from '@sabi/core'

test('probe state stays inside the project, never the ordinary profile', () => {
  const expected = fileURLToPath(new URL('../../../../.sabi/compat/prime-agent/', import.meta.url))
  assert.equal(probeRoot, expected)
  for (const variant of probeVariants) {
    const env = probeEnvironment(variant)
    for (const key of ['HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
      'TMPDIR', 'PRIME_AGENT_CODING_AGENT_DIR', 'PRIME_AGENT_SESSION_DIR', 'SABI_PRIME_PROBE_EVENTS']) {
      const relative = path.relative(probeRoot, env[key]!)
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), key)
    }
    assert.equal(env.PI_OFFLINE, '1')
    assert.equal(env.PRIME_AGENT_TELEMETRY, '0')
    assert.equal(env.DO_NOT_TRACK, '1')
    assert.equal(env.SABI_PRIME_PROBE_VARIANT, variant)
    for (const key of ['PRIME_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY',
      'TYPESAFE_API_KEY', 'SABI_CONFIG', 'NODE_OPTIONS', 'PYTHONPATH', 'HTTP_PROXY', 'HTTPS_PROXY']) {
      assert.equal(Object.hasOwn(env, key), false, key)
    }
  }
})

test('fixture disables telemetry, retry, compaction and resource discovery', () => {
  const settings = probeSettings()
  assert.equal(settings.telemetry.enabled, false)
  assert.equal(settings.retry.enabled, false)
  assert.equal(settings.retry.provider.timeoutMs, 4000)
  assert.equal(settings.retry.provider.waitForUsage.enabled, false)
  assert.equal(settings.compaction.enabled, false)
  assert.equal(settings.enableBuiltinSkills, false)
  assert.deepEqual(settings.packages, [])
  assert.deepEqual(settings.extensions, [])
  assert.deepEqual(settings.skills, [])
})

test('Prime uses Chat Completions, loopback, explicit synthetic model limits and a dummy key', () => {
  const provider = probeModels(8787).providers['sabi-local-probe']
  assert.equal(provider.baseUrl, 'http://127.0.0.1:8787/v1')
  assert.equal(provider.api, 'openai-completions')
  assert.equal(provider.apiKey, 'sabi-local-placeholder')
  assert.deepEqual(provider.headers, { 'X-Sabi-Client': 'prime-agent' })
  assert.equal(provider.compat.maxTokensField, 'max_tokens')
  assert.equal(provider.compat.supportsDeveloperRole, false)
  assert.deepEqual(provider.models.map(m => m.id), ['sabi-code', 'probe-first', 'probe-second'])
  assert.ok(provider.models.every(m => m.contextWindow === 32000 && m.maxTokens === 2048))
  for (const bad of [0, -1, 65536, NaN, 1.5]) assert.throws(() => probeModels(bad), /invalid mock port/)
})

test('proxy fixture uses shared strict policy with no credentials or Jev', () => {
  const config = mockSabiConfig(8788)
  assert.equal(config.compatibility?.mode, 'strict')
  assert.equal(config.upstreams.mock.apiKey, false)
  assert.equal(config.upstreams.mock.baseURL, 'http://127.0.0.1:8788/v1')
  assert.equal(config.judge?.enabled, false)
  assert.equal(config.telemetry?.captureSnippets, false)
  const decision = route({ model: 'sabi-code', messages: [{ role: 'user', content: 'Synthetic fixture' }],
    stream: true, max_tokens: 2048, reasoning_effort: 'medium', store: false,
    stream_options: { include_usage: true },
    tools: [{ type: 'function', function: { name: 'sabi_probe' } }],
  }, config)
  assert.equal(decision.tier, 'mid')
  assert.equal(decision.upstreamModel, 'mock-mid')
  assert.throws(() => mockSabiConfig(65536), /invalid mock port/)
})
