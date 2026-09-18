import test from 'node:test'
import assert from 'node:assert/strict'
import { decideTier, matches, POLICY_ORDER } from '../src/policy.ts'
import type { TrajectoryState } from '../src/types.ts'

function state(patch: Partial<TrajectoryState>): TrajectoryState {
  return {
    messageCount: 4,
    assistantTurns: 1,
    toolMessages: 1,
    lastRole: 'tool',
    contextChars: 1000,
    estimatedTokens: 280,
    hasTools: true,
    toolNames: ['read_file'],
    lastToolNames: ['read_file'],
    roundKind: 'exploration',
    failure: 'none',
    failureEvidence: [],
    ...patch,
  }
}

const policy = {
  failure: 'strong',
  stuck: 'mid',
  'context-pressure': 'mid',
  'first-turn': 'mid',
  verification: 'mid',
  implementation: 'mid',
  exploration: 'cheap',
  unclassified: 'cheap',
}

test('hard failure escalates to strong even on an exploration round', () => {
  const decision = decideTier(state({ failure: 'hard', failureEvidence: ['fail-marker'] }), policy)
  assert.equal(decision.rule, 'failure')
  assert.equal(decision.tier, 'strong')
  assert.match(decision.reason, /fail-marker/)
})

test('first turn routes to mid', () => {
  const decision = decideTier(state({ roundKind: 'first-turn', assistantTurns: 0 }), policy)
  assert.equal(decision.rule, 'first-turn')
  assert.equal(decision.tier, 'mid')
})

test('exploration routes to cheap', () => {
  const decision = decideTier(state({}), policy)
  assert.equal(decision.rule, 'exploration')
  assert.equal(decision.tier, 'cheap')
})

test('verification and implementation route to mid', () => {
  assert.equal(decideTier(state({ roundKind: 'verification' }), policy).tier, 'mid')
  assert.equal(decideTier(state({ roundKind: 'implementation' }), policy).tier, 'mid')
})

test('policy overrides are honoured', () => {
  const custom = { ...policy, exploration: 'mid' }
  assert.equal(decideTier(state({}), custom).tier, 'mid')
})

test('disabled rules are skipped', () => {
  const custom = { ...policy, exploration: 'off' }
  const decision = decideTier(state({}), custom)
  assert.equal(decision.rule, 'fallback')
  assert.equal(decision.tier, 'cheap')
})

test('policy order is stuck and failure first, unclassified last', () => {
  assert.equal(POLICY_ORDER[0], 'stuck')
  assert.equal(POLICY_ORDER[1], 'failure')
  assert.equal(POLICY_ORDER[POLICY_ORDER.length - 1], 'unclassified')
})

test('condition matching maps round kinds', () => {
  assert.equal(matches('verification', state({ roundKind: 'verification' })), true)
  assert.equal(matches('verification', state({ roundKind: 'exploration' })), false)
  assert.equal(matches('failure', state({ failure: 'soft' })), false)
  assert.equal(matches('failure', state({ failure: 'hard' })), true)
})

test('a repeated failure routes to the stuck tier instead of escalating further', () => {
  const decision = decideTier(state({ failure: 'hard', repeatedFailure: true, failureStreak: 2 }), policy)
  assert.equal(decision.rule, 'stuck')
  assert.equal(decision.tier, 'mid')
})

test('context pressure routes to the context-pressure tier above failure', () => {
  const decision = decideTier(
    state({ roundKind: 'unclassified', contextTokens: 95_000, contextWindow: 100_000, failure: 'none' }),
    policy,
  )
  assert.equal(decision.rule, 'context-pressure')
  assert.equal(decision.tier, 'mid')
})

test('an unknown context window never triggers context pressure', () => {
  const decision = decideTier(state({ contextTokens: 90_000, contextWindow: undefined }), policy)
  assert.notEqual(decision.rule, 'context-pressure')
})
