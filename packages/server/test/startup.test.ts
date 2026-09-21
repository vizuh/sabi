import test from 'node:test'
import assert from 'node:assert/strict'
import type { SabiConfig } from '@sabi/core'
import { credentialWarnings } from '../src/server.ts'

function config(overrides: Partial<SabiConfig> = {}): SabiConfig {
  return {
    upstreams: {},
    models: {},
    aliases: {},
    policy: {},
    ...overrides,
  }
}

test('credential warnings name the field without echoing a pasted key', () => {
  const literal = 'sk-ant-pasted-secret-0123456789abcdef'
  const warnings = credentialWarnings(config({
    upstreams: { openrouter: { baseURL: 'https://example.invalid', apiKey: literal } },
  }), {})
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] as string, /openrouter/)
  assert.equal((warnings[0] as string).includes(literal), false)
})

test('credential warnings keep the env reference but never the value', () => {
  const warnings = credentialWarnings(config({
    upstreams: { openrouter: { baseURL: 'https://example.invalid', apiKey: '$OPENROUTER_API_KEY' } },
    judge: { enabled: true, baseURL: 'https://example.invalid', apiKey: '$TYPESAFE_API_KEY' },
  }), {})
  assert.deepEqual(warnings, ['openrouter ($OPENROUTER_API_KEY is not set)', 'judge ($TYPESAFE_API_KEY is not set)'])
})

test('credential warnings stay silent when keys resolve', () => {
  const warnings = credentialWarnings(config({
    upstreams: { openrouter: { baseURL: 'https://example.invalid', apiKey: '$OPENROUTER_API_KEY' } },
  }), { OPENROUTER_API_KEY: 'set-in-env' })
  assert.deepEqual(warnings, [])
})

test('credential warnings redact a literal judge key the same way', () => {
  const literal = 'sk-ant-judge-secret-0123456789abcdef'
  const warnings = credentialWarnings(config({
    judge: { enabled: true, baseURL: 'https://example.invalid', apiKey: literal },
  }), {})
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] as string, /judge/)
  assert.equal((warnings[0] as string).includes(literal), false)
})
