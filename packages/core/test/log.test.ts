import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendDecision, estimateCost, hashIdentity, sessionIdFor } from '../src/log.ts'
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
