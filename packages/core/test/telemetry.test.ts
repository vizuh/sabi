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

test('provider errors never persist bare credentials (#61)', () => {
  // Bare OpenAI-style key with no keyword on the line.
  const bare = sanitizeError('401 Unauthorized: sk-proj-abc1234567890abcdef')
  assert.ok(!bare.includes('sk-proj-abc1234567890abcdef'), `bare key survived: ${bare}`)
  // Quoted JSON key: the character after the keyword is a quote, not = : or space.
  const quoted = sanitizeError('{"error":{"message":"invalid api key","api_key":"sk-ant-XXXXYYYYZZZZ"}}')
  assert.ok(!quoted.includes('sk-ant-XXXXYYYYZZZZ'), `quoted key survived: ${quoted}`)
  // AWS access key without a keyword.
  const aws = sanitizeError('AWS key AKIAIOSFODNN7EXAMPLE rejected')
  assert.ok(!aws.includes('AKIAIOSFODNN7EXAMPLE'), `AWS key survived: ${aws}`)
  // GitHub token after a space separator.
  const ghp = sanitizeError('token ghp_A1b2C3d4E5f6G7h8I9j0')
  assert.ok(!ghp.includes('ghp_A1b2C3d4E5f6G7h8I9j0'), `token survived: ${ghp}`)
  // Credential-bearing URL.
  const url = sanitizeError('fetch failed for postgres://usuario:senha@host:5432/db')
  assert.ok(!url.includes('senha@'), `credential URL survived: ${url}`)
  // A private-key block is dropped to a placeholder, not persisted.
  assert.equal(sanitizeError('crash: -----BEGIN RSA PRIVATE KEY----- deadbeef'), 'upstream error redacted (possible secret)')
  // Clean errors stay diagnosable.
  assert.match(sanitizeError('typesafe 401: nope'), /typesafe 401/)
  assert.equal(sanitizeError(''), 'unknown error')
})

test('the content canary covers common credential shapes (#70)', () => {
  assert.equal(looksLikeCanary('ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3'), true)
  assert.equal(looksLikeCanary('github_pat_11ABCDEFG1234567890abcdef'), true)
  assert.equal(looksLikeCanary('postgres://usuario:senha@host:5432/db'), true)
  assert.equal(looksLikeCanary('DB_PASSWORD=hunter2segredo'), true)
  assert.equal(looksLikeCanary('export AWS_SECRET=hunter2value'), true)
  assert.equal(looksLikeCanary('ordinary diff text with no markers'), false)
})