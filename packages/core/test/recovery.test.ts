import test from 'node:test'
import assert from 'node:assert/strict'
import { attributeRecovery, candidateBeatsIncumbent, computeRecovery, recoveryPairs, recoveryRate, recoveryStats, stateFingerprint } from '../src/recovery.ts'
import type { DecisionRecord } from '../src/types.ts'

const baseState = {
  messageCount: 4,
  assistantTurns: 1,
  toolMessages: 1,
  lastRole: 'tool',
  contextChars: 100,
  estimatedTokens: 100,
  hasTools: true,
  toolNames: ['shell_command'],
  lastToolNames: ['shell_command'],
  roundKind: 'verification' as const,
  failure: 'none' as const,
  failureEvidence: [] as string[],
}

function row(patch: Omit<Partial<DecisionRecord>, 'state'> & { state?: Partial<DecisionRecord['state']> } = {}): DecisionRecord {
  return {
    ts: new Date().toISOString(),
    sessionId: 's1',
    sessionKnown: true,
    alias: 'sabi-code',
    mode: 'auto',
    rule: 'failure',
    tier: 'strong',
    reason: 'x',
    upstream: 'openrouter',
    upstreamModel: 'anthropic/claude-sonnet-5',
    stream: false,
    outcome: 'ok',
    ...patch,
    state: { ...baseState, ...patch.state },
  } as DecisionRecord
}

test('a hard-failure round followed by a clean round is a recovery, credited to the earlier round', () => {
  const records = [
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ tier: 'mid', upstreamModel: 'm-mid', state: { failure: 'none' } }),
  ]
  const profile = computeRecovery(records)
  assert.deepEqual(recoveryStats(profile, 'strong', 'm-strong'), { recoveries: 1, nonRecoveries: 0 })
  assert.equal(recoveryStats(profile, 'mid', 'm-mid'), undefined, 'credit belongs to the stuck round, not the round after it')
})

test('a hard-failure round followed by another failing round is a non-recovery', () => {
  const records = [
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'soft' } }),
  ]
  const profile = computeRecovery(records)
  assert.deepEqual(recoveryStats(profile, 'strong', 'm-strong'), { recoveries: 0, nonRecoveries: 1 })
})

test('an intervening non-ok round breaks adjacency instead of being silently dropped', () => {
  // A, aborted-B, clean-C: A and C are two rounds apart, not adjacent — must not be paired.
  const records = [
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ outcome: 'aborted', tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'none' } }),
  ]
  const profile = computeRecovery(records)
  assert.equal(recoveryStats(profile, 'strong', 'm-strong'), undefined, 'the aborted round must break adjacency, not be dropped from the sequence')
})

test('a pair straddling a host compaction (contextGeneration differs) is excluded', () => {
  const records = [
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard', contextGeneration: 0 } }),
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'none', contextGeneration: 1 } }),
  ]
  const profile = computeRecovery(records)
  assert.equal(recoveryStats(profile, 'strong', 'm-strong'), undefined)
})

test('a successor with a transport failure is excluded — not a model outcome', () => {
  const records = [
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'transport' } }),
  ]
  const profile = computeRecovery(records)
  assert.equal(recoveryStats(profile, 'strong', 'm-strong'), undefined)
})

test('a session\'s trailing hard-failure round with no successor is censored, not counted', () => {
  const records = [row({ tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } })]
  const profile = computeRecovery(records)
  assert.equal(recoveryStats(profile, 'strong', 'm-strong'), undefined)
})

test('rows without a known session are never paired', () => {
  const records = [
    row({ sessionKnown: false, tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ sessionKnown: false, tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'none' } }),
  ]
  const profile = computeRecovery(records)
  assert.equal(recoveryStats(profile, 'strong', 'm-strong'), undefined)
})

test('recoveryRate is undefined below the minimum sample size, and correct at/above it', () => {
  const records: DecisionRecord[] = []
  for (let i = 0; i < 29; i++) {
    records.push(
      row({ sessionId: `s${i}`, tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
      row({ sessionId: `s${i}`, tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'none' } }),
    )
  }
  const below = computeRecovery(records)
  assert.equal(recoveryRate(below, 'strong', 'm-strong'), undefined, '29 eligible pairs must not clear the n=30 gate')

  records.push(
    row({ sessionId: 's-last', tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ sessionId: 's-last', tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'none' } }),
  )
  const at = computeRecovery(records)
  const rate = recoveryRate(at, 'strong', 'm-strong')
  assert.ok(rate)
  assert.equal(rate.eligible, 30)
  assert.equal(rate.recoveries, 30)
  assert.equal(rate.pHat, 1)
  // All-recovery n=30: one-sided 95% Wilson bound (z=1.6449) is lower~0.91727, upper~1.0.
  assert.ok(Math.abs(rate.wilsonLower - 0.91727) < 0.001, `expected lower ~0.91727, got ${rate.wilsonLower}`)
  assert.ok(Math.abs(rate.wilsonUpper - 1) < 0.001, `expected upper ~1, got ${rate.wilsonUpper}`)
})

test('recoveryRate: a mixed, known (p-hat, n) pair matches hand-computed Wilson bounds', () => {
  // p̂ = 0.8, n = 40 (32 recoveries, 8 non-recoveries): one-sided 95% Wilson bounds ≈ [0.67853, 0.88345].
  const records: DecisionRecord[] = []
  for (let i = 0; i < 40; i++) {
    const recovered = i < 32
    records.push(
      row({ sessionId: `s${i}`, tier: 'mid', upstreamModel: 'm-mid', state: { failure: 'hard' } }),
      row({ sessionId: `s${i}`, tier: 'mid', upstreamModel: 'm-mid', state: { failure: recovered ? 'none' : 'soft' } }),
    )
  }
  const profile = computeRecovery(records)
  const rate = recoveryRate(profile, 'mid', 'm-mid')
  assert.ok(rate)
  assert.equal(rate.eligible, 40)
  assert.equal(rate.pHat, 0.8)
  assert.ok(Math.abs(rate.wilsonLower - 0.67853) < 0.001, `expected lower ~0.67853, got ${rate.wilsonLower}`)
  assert.ok(Math.abs(rate.wilsonUpper - 0.88345) < 0.001, `expected upper ~0.88345, got ${rate.wilsonUpper}`)
})

test('candidateBeatsIncumbent: a non-overlapping-interval test, not a point-estimate comparison', () => {
  const strong: DecisionRecord[] = []
  const mid: DecisionRecord[] = []
  for (let i = 0; i < 30; i++) {
    strong.push(
      row({ sessionId: `strong${i}`, tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
      row({ sessionId: `strong${i}`, tier: 'strong', upstreamModel: 'm-strong', state: { failure: i < 20 ? 'none' : 'soft' } }), // pHat ~0.667
    )
    mid.push(
      row({ sessionId: `mid${i}`, tier: 'mid', upstreamModel: 'm-mid', state: { failure: 'hard' } }),
      row({ sessionId: `mid${i}`, tier: 'mid', upstreamModel: 'm-mid', state: { failure: i < 22 ? 'none' : 'soft' } }), // pHat ~0.733, close, overlapping CIs
    )
  }
  const profile = computeRecovery([...strong, ...mid])
  const incumbent = recoveryRate(profile, 'strong', 'm-strong')
  const candidate = recoveryRate(profile, 'mid', 'm-mid')
  assert.ok(incumbent && candidate)
  assert.ok(candidate.pHat > incumbent.pHat, 'candidate has the higher point estimate')
  assert.equal(candidateBeatsIncumbent(candidate, incumbent), false, 'overlapping confidence intervals must not count as a credible win')
  assert.equal(candidateBeatsIncumbent(undefined, incumbent), false)
  assert.equal(candidateBeatsIncumbent(candidate, undefined), false)
})

test('a structurally incomplete row is skipped instead of disabling the profile (#69)', () => {
  const good = [
    row({ sessionId: 's-good', tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'hard' } }),
    row({ sessionId: 's-good', tier: 'strong', upstreamModel: 'm-strong', state: { failure: 'none' } }),
  ]
  const malformed = { sessionId: 's-good', sessionKnown: true, outcome: 'ok' } as unknown as DecisionRecord
  const shapeless = [
    malformed,
    { sessionId: 's-good', sessionKnown: true, outcome: 'ok', state: null } as unknown as DecisionRecord,
    { sessionId: 's-good', sessionKnown: true, outcome: 'ok', state: { failure: 42 } } as unknown as DecisionRecord,
  ]
  assert.doesNotThrow(() => computeRecovery([...shapeless, ...good]))
  const profile = computeRecovery([...shapeless, ...good])
  assert.deepEqual(recoveryStats(profile, 'strong', 'm-strong'), { recoveries: 1, nonRecoveries: 0 })
})

test('rows without a usable session identity are never grouped', () => {
  const records = [
    { ...row({ state: { failure: 'hard' } }), sessionId: undefined } as unknown as DecisionRecord,
    { ...row({ state: { failure: 'none' } }), sessionId: undefined } as unknown as DecisionRecord,
  ]
  assert.doesNotThrow(() => computeRecovery(records))
  assert.equal(computeRecovery(records).size, 0)
})
test('recoveryPairs decodes tier/upstreamModel without ever splitting a hand-built key', () => {
  const records = [
    row({ tier: 'strong', upstreamModel: 'weird::model/id', state: { failure: 'hard' } }),
    row({ tier: 'strong', upstreamModel: 'weird::model/id', state: { failure: 'none' } }),
  ]
  const profile = computeRecovery(records)
  const pairs = recoveryPairs(profile)
  assert.deepEqual(pairs, [{ tier: 'strong', upstreamModel: 'weird::model/id' }])
})

test('recovery attribution keeps observed, matched, and replayed grades separate for identical state', () => {
  const before = { ...baseState, failure: 'hard' as const, failureEvidence: ['fail-marker'], contextGeneration: 2 }
  const after = { ...baseState, failure: 'none' as const, failureEvidence: [], contextGeneration: 2 }
  assert.equal(stateFingerprint(before), stateFingerprint({ ...before }))

  const observed = attributeRecovery({ before, after, action: 'retry-with-feedback' })
  const matched = attributeRecovery({ before, after: before, action: 'retry-with-feedback', matched: true })
  const replayed = attributeRecovery({ before, after: before, action: 'retry-with-feedback', replay: { safe: true, receiptId: 'fixture-receipt-1' } })
  assert.equal(observed.evidenceGrade, 'observed')
  assert.equal(matched.evidenceGrade, 'matched')
  assert.equal(replayed.evidenceGrade, 'replayed')
  assert.equal(replayed.receiptId, 'fixture-receipt-1')
  assert.equal(observed.stateFingerprint, matched.stateFingerprint)
})

test('unsafe or stale replay never receives replay evidence', () => {
  const before = { ...baseState, failure: 'hard' as const, contextGeneration: 1 }
  const after = { ...baseState, failure: 'none' as const, contextGeneration: 2 }
  const result = attributeRecovery({ before, after, action: 'fresh-context', matched: true, replay: { safe: false, receiptId: 'not-used' } })
  assert.equal(result.evidenceGrade, 'observed')
  assert.equal(result.receiptId, undefined)
})
