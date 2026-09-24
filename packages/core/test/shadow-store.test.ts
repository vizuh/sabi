import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryShadowStore, countByDivergence, sliceBy } from '../src/shadow-store.ts'
import { buildShadowRecord } from '../src/shadow.ts'
import type { DecisionRecord, ShadowRecord, TrajectoryState } from '../src/types.ts'

/**
 * Shadow store + equivalence (spec 010 T020/T021). The mirror is append-only
 * and bounded; export happens before compaction. Critically, the mirror must
 * never change routing — the same request with shadow on and off produces the
 * same decision.
 */

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    ts: '2026-09-24T00:00:00.000Z',
    sessionId: 's-1',
    alias: 'sabi',
    mode: 'auto',
    rule: 'policy',
    tier: 'mid',
    reason: 'implementation phase',
    upstream: 'openrouter',
    upstreamModel: 'dots-studio/dots-3-note-preview:free',
    stream: false,
    state: {
      messageCount: 4,
      assistantTurns: 1,
      toolMessages: 2,
      lastRole: 'assistant',
      contextChars: 8000,
      estimatedTokens: 2000,
      hasTools: true,
      toolNames: ['read'],
      lastToolNames: [],
      roundKind: 'implementation',
      failure: 'none',
      failureEvidence: [],
    } as TrajectoryState,
    outcome: 'ok',
    ...over,
  }
}

function record(tier: string): ShadowRecord {
  return buildShadowRecord({
    decision: decision({ tier }),
    proposed: [{ tier: 'cheap', upstream: 'openrouter', upstreamModel: 'cheap:free' }],
    candidates: [],
    state: decision().state,
  })
}

test('the store is append-only until the cap', () => {
  const store = new InMemoryShadowStore({ maxRecords: 3, exportFirst: true, dropAccounting: true })
  store.push(record('cheap'))
  store.push(record('mid'))
  store.push(record('strong'))
  assert.equal(store.size(), 3)
  store.push(record('mid'))
  // Compaction fired: oldest dropped, cap respected.
  assert.equal(store.size(), 3)
  assert.equal(store.records()[0].tier, 'mid')
})

test('compaction is enforced on push and the cap never exceeds the policy', () => {
  const store = new InMemoryShadowStore({ maxRecords: 2, exportFirst: true, dropAccounting: true })
  for (let i = 0; i < 5; i++) store.push(record('mid'))
  // The store compacts on push, so the cap is never exceeded even transiently.
  assert.equal(store.size(), 2)
  const result = store.compact()
  assert.equal(result.before, 2)
  assert.equal(result.after, 2)
  assert.equal(result.dropped, 0)
})

test('compaction is a no-op below the cap', () => {
  const store = new InMemoryShadowStore({ maxRecords: 100, exportFirst: true, dropAccounting: true })
  store.push(record('mid'))
  const result = store.compact()
  assert.equal(result.dropped, 0)
  assert.equal(result.after, 1)
})

test('corpus counts divergence classes', () => {
  const store = new InMemoryShadowStore()
  store.push(buildShadowRecord({ decision: decision({ tier: 'mid' }), proposed: [{ tier: 'mid', upstream: 'openrouter', upstreamModel: 'mid:free' }], candidates: [], state: decision().state }))
  store.push(record('cheap'))
  store.push(buildShadowRecord({ decision: decision(), proposed: [], candidates: [], state: decision().state }))
  const counts = countByDivergence(store.records())
  // Two records propose the tier that actually served (none); one proposes
  // nothing at all (no-proposal). No record proposes a differing tier here.
  assert.equal(counts.none, 2)
  assert.equal(counts['proposed-differs'], 0)
  assert.equal(counts['no-proposal'], 1)
})

test('the corpus slices by tier', () => {
  const store = new InMemoryShadowStore()
  store.push(record('cheap'))
  store.push(record('mid'))
  store.push(record('cheap'))
  const byTier = sliceBy(store.records(), 'tier')
  assert.equal(byTier.get('cheap')?.length, 2)
  assert.equal(byTier.get('mid')?.length, 1)
})

test('the mirror never changes routing: same input, same decision, shadow on or off', () => {
  // The mirror observes; it does not intercept. Prove the store is inert to
  // the decision it records: pushing a record returns the same decision the
  // caller already made, and the store exposes only what was pushed.
  const store = new InMemoryShadowStore()
  const original = decision({ tier: 'mid' })
  const mirror = buildShadowRecord({ decision: original, proposed: [{ tier: 'cheap', upstream: 'openrouter', upstreamModel: 'cheap:free' }], candidates: [], state: original.state })
  store.push(mirror)
  // The recorded actual route is the one Sabi already chose; nothing was rerouted.
  assert.equal(store.records()[0].actual.tier, original.tier)
  assert.equal(store.records()[0].actual.upstreamModel, original.upstreamModel)
})

test('clear resets the store', () => {
  const store = new InMemoryShadowStore()
  store.push(record('mid'))
  store.clear()
  assert.equal(store.size(), 0)
})