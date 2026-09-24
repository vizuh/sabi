import test from 'node:test'
import assert from 'node:assert/strict'
import { ShadowMirror } from '../src/shadow-sink.ts'
import type { DecisionRecord } from '../src/types.ts'

/**
 * Mirror sink wiring (spec 010 T021 + T041). The sink observes completed
 * decisions; it must never influence routing, and a rejected record is
 * quarantined with a reason rather than dropped silently.
 */

function record(over: Partial<DecisionRecord> = {}): DecisionRecord {
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
    } as DecisionRecord['state'],
    outcome: 'ok',
    ...over,
  }
}

test('the sink records the decision it observed', () => {
  const mirror = new ShadowMirror()
  mirror.observe(record())
  assert.equal(mirror.records().length, 1)
  assert.equal(mirror.records()[0].actual.tier, 'mid')
  assert.equal(mirror.stats().written, 1)
})

test('observe does not mutate the observed record', () => {
  const mirror = new ShadowMirror()
  const original = record()
  const before = JSON.stringify(original)
  mirror.observe(original)
  assert.equal(JSON.stringify(original), before)
})

test('a proposed alternative tier is recorded as divergence, not applied', () => {
  const mirror = new ShadowMirror({ proposed: () => 'cheap' })
  mirror.observe(record({ tier: 'mid' }))
  const mirrored = mirror.records()[0]
  // The mirror records that 'cheap' was proposed; the actual route stays 'mid'.
  assert.equal(mirrored.actual.tier, 'mid')
  assert.equal(mirrored.proposed[0].tier, 'cheap')
  assert.equal(mirrored.divergence, 'proposed-differs')
})

test('a proposal equal to the actual route is not divergence', () => {
  const mirror = new ShadowMirror({ proposed: (r) => r.tier })
  mirror.observe(record({ tier: 'mid' }))
  assert.equal(mirror.records()[0].divergence, 'none')
})

test('the candidate set is captured beside the actual decision', () => {
  const mirror = new ShadowMirror({ candidates: () => ['cheap', 'mid', 'strong'] })
  mirror.observe(record())
  assert.equal(mirror.records()[0].candidates.length, 3)
})

test('the store cap is enforced and drops are accounted', () => {
  const mirror = new ShadowMirror({ policy: { maxRecords: 2, exportFirst: true, dropAccounting: true } })
  for (let i = 0; i < 5; i++) mirror.observe(record())
  assert.equal(mirror.records().length, 2)
  assert.equal(mirror.stats().written, 5)
  assert.ok(mirror.stats().dropped > 0)
})

test('a record the sanitizer rejects is quarantined with a reason, never merged', () => {
  const mirror = new ShadowMirror()
  // A record whose failure evidence carries an unallowlisted code cannot be
  // translated; it must be quarantined, not written into the corpus.
  const bad = record()
  bad.state = { ...bad.state, failureEvidence: ['not-a-real-code'] }
  mirror.observe(bad)
  assert.equal(mirror.records().length, 0)
  assert.equal(mirror.stats().quarantined, 1)
  const reasons = mirror.rejections()
  assert.equal(reasons.length, 1)
  assert.match(reasons[0].reason, /not-a-real-code/)
})

test('quarantine never stops later healthy records from being mirrored', () => {
  const mirror = new ShadowMirror()
  const bad = record()
  bad.state = { ...bad.state, failureEvidence: ['not-a-real-code'] }
  mirror.observe(bad)
  mirror.observe(record())
  assert.equal(mirror.records().length, 1)
  assert.equal(mirror.stats().quarantined, 1)
  assert.equal(mirror.stats().written, 1)
})

test('stats report divergence counts over the corpus', () => {
  const mirror = new ShadowMirror({ proposed: () => 'cheap' })
  // One round where the mirror wanted cheap and the router served mid: divergence.
  mirror.observe(record({ tier: 'mid' }))
  // One round where the mirror wanted cheap and the router agreed: agreement.
  mirror.observe(record({ tier: 'cheap' }))
  const stats = mirror.stats()
  assert.equal(stats.byDivergence['proposed-differs'], 1)
  assert.equal(stats.byDivergence.none, 1)
})

test('the corpus is sliceable by tier', () => {
  const mirror = new ShadowMirror()
  mirror.observe(record({ tier: 'cheap' }))
  mirror.observe(record({ tier: 'strong' }))
  assert.equal(mirror.slice('tier').get('cheap')?.length, 1)
  assert.equal(mirror.slice('tier').get('strong')?.length, 1)
})