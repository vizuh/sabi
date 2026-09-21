import test from 'node:test'
import assert from 'node:assert/strict'
import { planRecovery, recoveryPlanFromCandidate } from '../src/recovery-actions.ts'
import type { RecoveryPlan, TrajectoryState } from '../src/types.ts'

const baseState: TrajectoryState = {
  messageCount: 4,
  assistantTurns: 1,
  toolMessages: 1,
  lastRole: 'tool',
  contextChars: 100,
  estimatedTokens: 100,
  hasTools: true,
  toolNames: ['shell_command'],
  lastToolNames: ['shell_command'],
  roundKind: 'verification',
  failure: 'none',
  failureEvidence: [],
  contextGeneration: 0,
}

function state(patch: Partial<TrajectoryState>): TrajectoryState {
  return { ...baseState, ...patch }
}

test('deterministic recovery precedence keeps hard gates ahead of model choice', () => {
  const cases: Array<[string, TrajectoryState, Record<string, unknown>, string]> = [
    ['transport', state({ failure: 'transport', failureEvidence: ['rate-limited'] }), { currentProvider: 'provider-a' }, 'retry-same'],
    ['hard failure', state({ failure: 'hard', failureEvidence: ['fail-marker'] }), {}, 'escalate-model'],
    ['missing evidence', state({ verification: { status: 'needed', reason: 'mutation-without-receipt', generation: 0 } }), {}, 'gather-evidence'],
    ['repeated failure', state({ failure: 'hard', repeatedFailure: true, failureStreak: 2 }), {}, 'fresh-context'],
    ['user denial', state({ failureEvidence: ['permission-denial'] }), {}, 'ask-user'],
    ['invalid receipt', state({ verification: { status: 'unknown', reason: 'invalid-receipt', generation: 0 } }), {}, 'ask-user'],
  ]
  for (const [label, trajectory, input, action] of cases) {
    const result = planRecovery({ state: trajectory, ...input })
    assert.equal(result.action, action, label)
    assert.equal(result.source, 'deterministic', label)
  }
  assert.equal(planRecovery({ state: baseState, exhaustedRoutes: true }).action, 'ask-user')
})

test('transport recovery excludes the failed route without escalating the same provider', () => {
  const result = planRecovery({
    state: state({ failure: 'transport', failureEvidence: ['quota-exceeded'] }),
    currentRoute: 'mid',
    currentProvider: 'provider-a',
    retriesRemaining: 1,
  })
  assert.equal(result.action, 'retry-same')
  assert.deepEqual(result.constraints, { excludeRoutes: ['mid'], excludeProviders: ['provider-a'] })
  assert.equal(result.retryable, true)
})

test('judge action candidates are allowlisted and cannot invent a route action', () => {
  const fallback: RecoveryPlan = { action: 'gather-evidence', reason: 'missing-evidence', retryable: false, source: 'deterministic' }
  assert.equal(recoveryPlanFromCandidate({ action: 'not-an-action', reason: 'hard-failure' }, fallback), fallback)
  assert.deepEqual(recoveryPlanFromCandidate({ action: 'fresh-context', reason: 'repeated-failure' }, fallback), {
    action: 'fresh-context',
    reason: 'repeated-failure',
    retryable: false,
    source: 'judge',
  })
})
