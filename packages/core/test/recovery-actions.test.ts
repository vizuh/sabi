import test from 'node:test'
import assert from 'node:assert/strict'
import { planRecovery, recoveryPlanFromCandidate } from '../src/recovery-actions.ts'
import type { ExecutionCapabilities, RecoveryPlan, TrajectoryState } from '../src/types.ts'

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

const FULL_CAPS: ExecutionCapabilities = {
  repoMap: true,
  incrementalContext: true,
  deterministicEdit: true,
  isolatedWorkspaces: true,
  verifierReceipts: true,
  eventDrivenChanges: true,
}
const PARTIAL_CAPS: ExecutionCapabilities = { verifierReceipts: true, deterministicEdit: false }
const NO_CAPS: ExecutionCapabilities = {}

test('verify-local wins over repair and escalation only with declared verifier receipts', () => {
  const failedEdit = state({
    failure: 'hard',
    failureEvidence: ['fail-marker'],
    verification: { status: 'needed', reason: 'mutation-without-receipt', generation: 0 },
  })
  for (const [label, capabilities] of [['full', FULL_CAPS], ['partial', PARTIAL_CAPS]] as const) {
    const result = planRecovery({ state: failedEdit, capabilities })
    assert.equal(result.action, 'verify-local', label)
    assert.equal(result.reason, 'needs-verification', label)
    assert.equal(result.source, 'deterministic', label)
  }
  for (const [label, capabilities] of [['none', NO_CAPS], ['declared-false', { verifierReceipts: false }], ['omitted', undefined]] as const) {
    const result = planRecovery({ state: failedEdit, ...(capabilities ? { capabilities } : {}) })
    assert.equal(result.action, 'gather-evidence', label)
    assert.equal(result.reason, 'missing-evidence', label)
  }
  // Hard gates still win over verification.
  assert.equal(planRecovery({ state: failedEdit, capabilities: FULL_CAPS, userDenied: true }).action, 'ask-user')
  // An attempted verification with no receipt re-verifies locally.
  const attempted = state({ verification: { status: 'attempted', reason: 'missing-receipt', generation: 0 } })
  assert.equal(planRecovery({ state: attempted, capabilities: FULL_CAPS }).action, 'verify-local')
  // An unverified summary claim is not a mutation: evidence gathering, never a verifier run.
  const claim = state({ verification: { status: 'unknown', reason: 'summary-without-receipt', generation: 0 } })
  assert.equal(planRecovery({ state: claim, capabilities: FULL_CAPS }).action, 'gather-evidence')
  assert.equal(planRecovery({ state: claim, capabilities: FULL_CAPS }).reason, 'missing-evidence')
})

test('rollback bounded to a clean point requires both the point and deterministic edits', () => {
  const repeated = state({ failure: 'hard', failureEvidence: ['fail-marker'], repeatedFailure: true, failureStreak: 2 })
  const bounded = planRecovery({ state: repeated, capabilities: FULL_CAPS, cleanPoint: 'before-auth-migration' })
  assert.equal(bounded.action, 'rollback')
  assert.equal(bounded.reason, 'clean-point')
  // Capability undeclared or unknown: the 001 fallback chain is untouched.
  assert.equal(planRecovery({ state: repeated, cleanPoint: 'before-auth-migration' }).action, 'fresh-context')
  assert.equal(planRecovery({ state: repeated, capabilities: NO_CAPS, cleanPoint: 'before-auth-migration' }).action, 'fresh-context')
  assert.equal(
    planRecovery({ state: repeated, capabilities: PARTIAL_CAPS, cleanPoint: 'before-auth-migration', safeRollback: true }).action,
    'rollback-with-reflection',
  )
  // Capability without a clean point is not a bounded rollback.
  assert.equal(planRecovery({ state: repeated, capabilities: FULL_CAPS }).action, 'fresh-context')
  assert.equal(planRecovery({ state: repeated, capabilities: FULL_CAPS, safeRollback: true }).action, 'rollback-with-reflection')
  // A clean point without repeated failure is not a rollback trigger.
  const single = planRecovery({ state: state({ failure: 'hard', failureEvidence: ['fail-marker'] }), capabilities: FULL_CAPS, cleanPoint: 'before-auth-migration' })
  assert.equal(single.action, 'escalate-model')
})

test('switch-harness on transport failure only with a registered capable alternate', () => {
  const transport = state({ failure: 'transport', failureEvidence: ['quota-exceeded'] })
  const eligible = planRecovery({ state: transport, alternateCapableHarness: true, currentRoute: 'mid', currentProvider: 'provider-a' })
  assert.equal(eligible.action, 'switch-harness')
  assert.equal(eligible.reason, 'transport')
  assert.deepEqual(eligible.constraints, { excludeRoutes: ['mid'], excludeProviders: ['provider-a'] })
  // No capable alternate: 001 retry/route-removal behavior is unchanged.
  assert.equal(planRecovery({ state: transport }).action, 'retry-same')
  assert.equal(planRecovery({ state: transport, capabilities: FULL_CAPS }).action, 'retry-same')
})

test('escalation precision does not regress with capabilities declared', () => {
  const hard = state({ failure: 'hard', failureEvidence: ['fail-marker'] })
  assert.equal(planRecovery({ state: hard, capabilities: FULL_CAPS }).action, 'escalate-model')
  const failed = state({
    failure: 'hard',
    failureEvidence: ['fail-marker'],
    verification: { status: 'failed', reason: 'verification-receipt', generation: 0 },
  })
  assert.equal(planRecovery({ state: failed, capabilities: FULL_CAPS }).action, 'retry-with-feedback')
})

test('planner output is deterministic for identical input', () => {
  const input = {
    state: state({
      failure: 'hard',
      failureEvidence: ['fail-marker'],
      repeatedFailure: true,
      failureStreak: 2,
      verification: { status: 'needed' as const, reason: 'mutation-without-receipt' as const, generation: 0 },
    }),
    capabilities: FULL_CAPS,
    cleanPoint: 'before-auth-migration',
  }
  assert.deepEqual(planRecovery(input), planRecovery(input))
})
