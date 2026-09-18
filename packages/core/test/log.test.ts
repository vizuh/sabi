import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateCost, hashIdentity, sessionIdFor } from '../src/log.ts'

const usage = { promptTokens: 100, completionTokens: 20, cachedTokens: 40, totalTokens: 120 }

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
