import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildShadowRecord,
  divergenceReason,
  isShadowRecord,
  sanitizeShadowRecord,
} from '../src/shadow.ts'
import type { DecisionRecord, TrajectoryState } from '../src/types.ts'

/**
 * Shadow routing mirror (spec 010 US1, T001/T010/T011). Actual execution is
 * never touched: the mirror observes Sabi's own decision and records the
 * candidate set beside it. Divergence between actual and proposed is flagged
 * with a reason, never silently absorbed.
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

const cheap = { tier: 'cheap', upstream: 'openrouter', upstreamModel: 'poolside/laguna-s-2.1:free' }
const mid = { tier: 'mid', upstream: 'openrouter', upstreamModel: 'dots-studio/dots-3-note-preview:free' }

test('a shadow record carries the actual decision and the proposed candidate set', () => {
  const record = buildShadowRecord({
    decision: decision(),
    proposed: [cheap],
    candidates: [cheap, mid],
    state: decision().state,
  })
  assert.equal(record.actual.tier, 'mid')
  assert.equal(record.actual.upstreamModel, mid.upstreamModel)
  assert.deepEqual(record.proposed, [cheap])
  assert.equal(record.candidates.length, 2)
  // The proposed route is `cheap` while the actual is `mid`, so the mirror
  // flags the divergence rather than claiming a match.
  assert.equal(record.divergence, 'proposed-differs')
  assert.match(record.divergenceReason ?? '', /cheap/)
})

test('a proposed route matching the actual reads as no divergence', () => {
  const record = buildShadowRecord({
    decision: decision({ tier: 'mid' }),
    proposed: [mid],
    candidates: [],
    state: decision().state,
  })
  assert.equal(record.divergence, 'none')
  assert.equal(record.divergenceReason, undefined)
})

test('an empty candidate set is recorded as such, never as a full set', () => {
  const record = buildShadowRecord({
    decision: decision(),
    proposed: [],
    candidates: [],
    state: decision().state,
  })
  assert.deepEqual(record.candidates, [])
  assert.equal(record.proposed.length, 0)
  assert.equal(record.divergence, 'no-proposal')
})

test('a shadow record is recognized by its kind tag', () => {
  const record = buildShadowRecord({
    decision: decision(),
    proposed: [],
    candidates: [],
    state: decision().state,
  })
  assert.equal(isShadowRecord(record), true)
  assert.equal(isShadowRecord({ foo: 'bar' }), false)
})

test('sanitization never lets a secret-like field into the mirror', () => {
  const record = buildShadowRecord({
    decision: decision({ reason: 'ok' }),
    proposed: [],
    candidates: [],
    state: decision().state,
  })
  const sanitized = sanitizeShadowRecord(record)
  const serialized = JSON.stringify(sanitized)
  assert.ok(!serialized.includes('apiKey'))
  assert.ok(!serialized.includes('token'))
  assert.equal(sanitized.kind, 'shadow')
})

test('divergence reason names the proposed tier when it differs', () => {
  const reason = divergenceReason('mid', [cheap])
  assert.match(reason ?? '', /cheap/)
  assert.equal(divergenceReason('mid', []), undefined)
  assert.equal(divergenceReason('mid', [mid]), undefined)
})