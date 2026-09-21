import test from 'node:test'
import assert from 'node:assert/strict'
import { getFallbackChain } from '../src/router.ts'
import { validateConfig } from '../src/config.ts'

// All model metadata is synthetic. These are not claims about any live model.
function config(overrides: Record<string, unknown> = {}) {
  return validateConfig({
    upstreams: {
      mock: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false },
      off: { baseURL: 'http://127.0.0.1:9/v1', apiKey: false, enabled: false },
    },
    models: {
      cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 2 }, capabilities: { inputModalities: ['text'] } },
      mid: { upstream: 'mock', model: 'synthetic-mid', cost: { input: 5, output: 10 }, capabilities: { inputModalities: ['text', 'image'] } },
      strong: { upstream: 'mock', model: 'synthetic-strong', cost: { input: 10, output: 20 }, capabilities: { inputModalities: ['text', 'image'] } },
      parked: { upstream: 'off', model: 'synthetic-parked', cost: { input: 0, output: 1 }, capabilities: { inputModalities: ['text'] } },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap' },
    policy: { unclassified: 'cheap' },
    ...overrides,
  })
}

test('the chain excludes the failed tier and orders cheapest-first', () => {
  const chain = getFallbackChain(config(), 'mid')
  assert.deepEqual(chain.map((entry) => entry.tier), ['cheap', 'strong'])
  assert.equal(chain[0].upstreamModel, 'synthetic-cheap')
  assert.match(chain[0].reason, /fallback from mid/)
})

test('tiers behind a disabled upstream never appear in the chain', () => {
  const chain = getFallbackChain(config(), 'cheap')
  assert.ok(!chain.some((entry) => entry.tier === 'parked'), 'parked sits behind a disabled upstream')
})

test('input modalities are a hard constraint on the chain', () => {
  const chain = getFallbackChain(config(), 'strong', ['image'])
  assert.deepEqual(chain.map((entry) => entry.tier), ['mid'])
})

test('an unknown failed tier yields no chain', () => {
  assert.deepEqual(getFallbackChain(config(), 'nope'), [])
})

test('transportFallback is optional but must be a boolean flag', () => {
  assert.equal(validateConfig({ ...config(), transportFallback: { enabled: true } }).transportFallback?.enabled, true)
  assert.equal(validateConfig({ ...config(), transportFallback: { enabled: false } }).transportFallback?.enabled, false)
  assert.throws(() => validateConfig({ ...config(), transportFallback: true }), /transportFallback must be an object/)
  assert.throws(() => validateConfig({ ...config(), transportFallback: { enabled: 'yes' } }), /transportFallback\.enabled must be a boolean/)
})
