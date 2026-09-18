import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeCanary, sanitizeError, sanitizeReason, telemetryPolicy } from '../src/telemetry.ts'

test('allowlisted evidence codes survive by default', () => {
  const policy = telemetryPolicy(undefined)
  assert.equal(policy.allowlisted('fail-marker'), true)
  assert.equal(policy.allowlisted('fail-marker: Tests: 2 failed'), true)
  assert.equal(policy.allowlisted('raw excerpt: something'), false)
  assert.equal(sanitizeReason('failure evidence: fail-marker', policy), 'failure evidence: fail-marker')
})

test('a reason embedding raw text is withheld by default', () => {
  const policy = telemetryPolicy(undefined)
  const withheld = sanitizeReason('failure evidence: Tests: 2 failed in src/a.test.ts', policy)
  assert.equal(withheld, 'reason withheld (telemetry.allowlistOnly)')
})

test('snippet capture is opt-in and bounded', () => {
  const policy = telemetryPolicy({ captureSnippets: true, captureChars: 24 })
  assert.equal(policy.captureSnippets, true)
  const long = 'a'.repeat(100)
  assert.ok(policy.snippet(long).length <= 24)
})

test('upstream errors are redacted to a kind plus first line', () => {
  const clean = sanitizeError('typesafe 401: nope')
  assert.match(clean, /typesafe 401/)
  const secret = sanitizeError('authorization: Bearer sk-abcdef1234567890abcdef')
  assert.ok(!secret.includes('sk-abcdef1234567890abcdef'))
})

test('secret-like markers are detected by the canary heuristics', () => {
  assert.equal(looksLikeCanary('BEGIN RSA PRIVATE KEY'), true)
  assert.equal(looksLikeCanary('sk-live-ABCDEF1234567890abcdef'), true)
  assert.equal(looksLikeCanary('plain text'), false)
})