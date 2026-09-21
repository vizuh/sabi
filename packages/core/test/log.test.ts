import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendDecision,
  decisionLogWriteFailures,
  estimateCost,
  getIdentitySalt,
  hashIdentity,
  parseDecisionRecord,
  readDecisions,
  readLogWriteFailures,
  resetIdentitySaltCache,
  resetLogWriteFailuresForTests,
  sessionIdFor,
} from '../src/log.ts'
import type { DecisionRecord } from '../src/types.ts'

const usage = { promptTokens: 100, completionTokens: 20, cachedTokens: 40, totalTokens: 120 }

test('appendDecision writes a decision log that only the owner can read', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-log-'))
  try {
    const logFile = path.join(dir, 'nested', 'decisions.jsonl')
    // Only the file-permission side effect matters here — the record's content is irrelevant.
    appendDecision({ alias: 'sabi-cheap', rule: 'default' } as unknown as DecisionRecord, logFile)
    // POSIX-only: Windows has no owner/group/other permission bits to assert on. 0o600/0o700
    // bits are unaffected by any common POSIX umask (022, 002, ...), so this holds regardless
    // of the host's default umask.
    if (process.platform !== 'win32') {
      assert.equal(statSync(logFile).mode & 0o777, 0o600)
      assert.equal(statSync(path.dirname(logFile)).mode & 0o777, 0o700)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unknown sessions are unique; explicit identities are hashed and namespaced', () => {
  assert.notEqual(sessionIdFor(), sessionIdFor())
  const id = sessionIdFor('private-session', 'opencode')
  assert.match(id, /^[a-f0-9]{64}$/)
  assert.equal(id, sessionIdFor('private-session', 'opencode'))
  assert.notEqual(id, sessionIdFor('private-session', 'hermes'))
  assert.notEqual(id, hashIdentity('turn', 'opencode', 'private-session'))
  assert.ok(!id.includes('private-session'))
})

test('identity hashes are salted: same salt is stable, different salts diverge', () => {
  const priorSalt = process.env.SABI_ID_SALT
  try {
    process.env.SABI_ID_SALT = 'test-salt-a'
    resetIdentitySaltCache()
    assert.equal(getIdentitySalt(), 'test-salt-a')
    const a1 = hashIdentity('session', 'opencode', 's1')
    const a2 = hashIdentity('session', 'opencode', 's1')
    assert.match(a1, /^[a-f0-9]{64}$/)
    assert.equal(a1, a2)
    assert.ok(!a1.includes('s1'))

    process.env.SABI_ID_SALT = 'test-salt-b'
    resetIdentitySaltCache()
    const b1 = hashIdentity('session', 'opencode', 's1')
    assert.match(b1, /^[a-f0-9]{64}$/)
    assert.notEqual(a1, b1, 'a global unsalted hash would be identical on every machine')
  } finally {
    if (priorSalt === undefined) delete process.env.SABI_ID_SALT
    else process.env.SABI_ID_SALT = priorSalt
    resetIdentitySaltCache()
  }
})

test('a created salt file is user-scoped and mode 0600', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-salt-'))
  const priorFile = process.env.SABI_ID_SALT_FILE
  const priorSalt = process.env.SABI_ID_SALT
  try {
    delete process.env.SABI_ID_SALT
    const saltFile = path.join(dir, 'sub', '.identity-salt')
    process.env.SABI_ID_SALT_FILE = saltFile
    resetIdentitySaltCache()
    const first = getIdentitySalt()
    assert.ok(first.length >= 16)
    const second = getIdentitySalt()
    assert.equal(first, second, 'the salt must be stable within the process')
    assert.ok(readFileSync(saltFile, 'utf8').includes(first))
    assert.equal(statSync(saltFile).mode & 0o777, 0o600)
  } finally {
    if (priorFile === undefined) delete process.env.SABI_ID_SALT_FILE
    else process.env.SABI_ID_SALT_FILE = priorFile
    if (priorSalt === undefined) delete process.env.SABI_ID_SALT
    else process.env.SABI_ID_SALT = priorSalt
    resetIdentitySaltCache()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed decision-log write never throws and is counted for the report', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-logfail-'))
  try {
    // A regular file where the log directory should be: mkdirSync must fail.
    const blocker = path.join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const logFile = path.join(blocker, 'decisions.jsonl')
    resetLogWriteFailuresForTests()
    const before = decisionLogWriteFailures()
    const record = { ts: 't', sessionId: 's' } as DecisionRecord
    assert.doesNotThrow(() => appendDecision(record, logFile))
    assert.equal(decisionLogWriteFailures(), before + 1)
    const persisted = readLogWriteFailures(logFile)
    assert.equal(persisted, undefined, 'the sidecar cannot be written when the disk path itself is broken')
  } finally {
    resetLogWriteFailuresForTests()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readDecisions skips lines that parse but are not records', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-logread-'))
  try {
    const logFile = path.join(dir, 'decisions.jsonl')
    const valid = { ts: 't', sessionId: 's', sessionKnown: true } as DecisionRecord
    writeFileSync(logFile, ['null', '42', '"str"', '[1,2]', JSON.stringify(valid), '{oops'].join('\n'))
    const rows = readDecisions(logFile)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.sessionId, 's')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('missing or invalid prices remain unknown while explicit free pricing is zero', () => {
  assert.equal(estimateCost(usage), undefined)
  assert.equal(estimateCost(usage, { input: NaN, output: 2 }), undefined)
  assert.equal(estimateCost(usage, { input: 1, output: -2 }), undefined)
  assert.equal(estimateCost(usage, { input: 1, output: Infinity }), undefined)
  assert.equal(estimateCost(usage, { input: Number.MAX_VALUE, output: 2 }), undefined)
  assert.equal(estimateCost(usage, { input: 1, output: 2, cacheRead: -1 }), undefined)
  assert.equal(estimateCost({ ...usage, promptTokens: NaN }, { input: 1, output: 2 }), undefined)
  assert.deepEqual(estimateCost(usage, { input: 0, output: 0 }), { input: 0, output: 0, total: 0 })
  const cost = estimateCost(usage, { input: 10, output: 20, cacheRead: 1 })
  assert.ok(cost)
  assert.ok(Math.abs(cost.total - ((60 * 10 + 40) + 20 * 20) / 1e6) < 1e-10)
})

test('legacy decision rows remain readable when additive evidence fields are omitted', () => {
  const record = parseDecisionRecord(JSON.stringify({
    ts: '2026-09-20T00:00:00.000Z',
    sessionId: 'legacy',
    alias: 'sabi-code',
    mode: 'auto',
    rule: 'first-turn',
    tier: 'mid',
    reason: 'reason withheld (telemetry.allowlistOnly)',
    upstream: 'mock',
    upstreamModel: 'mock-mid',
    stream: false,
    state: {
      messageCount: 1,
      assistantTurns: 0,
      toolMessages: 0,
      lastRole: 'user',
      contextChars: 4,
      estimatedTokens: 2,
      hasTools: false,
      toolNames: [],
      lastToolNames: [],
      roundKind: 'first-turn',
      failure: 'none',
      failureEvidence: [],
    },
    outcome: 'ok',
  }))
  assert.ok(record)
  assert.equal(record?.state.verification, undefined)
  assert.equal(record?.recovery, undefined)
})

test('decision sanitization drops structurally compatible unknown fields', () => {
  const record = parseDecisionRecord({
    ts: 't',
    sessionId: 's',
    state: { messageCount: 1, rawPrompt: 'do-not-persist' },
    rawPrompt: 'do-not-persist',
    credentials: 'do-not-persist',
  } as unknown as DecisionRecord)
  assert.ok(record)
  assert.equal('rawPrompt' in record!, false)
  assert.equal('credentials' in record!, false)
  assert.equal('rawPrompt' in record!.state, false)
})
