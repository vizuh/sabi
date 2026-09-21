import test from 'node:test'
import assert from 'node:assert/strict'
import { matches } from '../src/policy.ts'
import { deterministicSignals, signalByKind, type SignalScope } from '../src/signal-producers.ts'
import { signalProblem, type DecisionSignal } from '../src/signals.ts'
import type { TrajectoryState } from '../src/types.ts'

const SCOPE: SignalScope = { sessionId: 'session-a', operationId: 'op-1', roundId: 'round-7', observedAt: 5_000 }

function state(overrides: Partial<TrajectoryState> = {}): TrajectoryState {
  return {
    messageCount: 4,
    assistantTurns: 1,
    toolMessages: 1,
    lastRole: 'tool',
    contextChars: 400,
    estimatedTokens: 100,
    contextTokens: 100,
    contextKnown: true,
    hasTools: true,
    toolNames: ['read'],
    lastToolNames: ['read'],
    roundKind: 'exploration',
    failure: 'none',
    failureEvidence: [],
    repeatedFailure: false,
    failureStreak: 0,
    ...overrides,
  }
}

function signalsFor(overrides: Partial<TrajectoryState>): DecisionSignal[] {
  const signals = deterministicSignals(state(overrides), SCOPE)
  for (const signal of signals) assert.equal(signalProblem(signal), undefined, signal.kind)
  return signals
}

test('every emitted signal validates and carries scope, expiry and shadow mode', () => {
  const signals = signalsFor({ failure: 'transport', failureEvidence: ['rate-limited'] })
  assert.ok(signals.length > 0)
  for (const signal of signals) {
    assert.equal(signal.sessionId, 'session-a')
    assert.equal(signal.operationId, 'op-1')
    assert.equal(signal.roundId, 'round-7')
    assert.equal(signal.mode, 'shadow')
    assert.equal(signal.source, 'deterministic')
    assert.equal(signal.expiresAt, 5_000 + 300_000)
  }
})

test('parity: failure.transport tracks the transport rule exactly', () => {
  const battery: Partial<TrajectoryState>[] = [
    { failure: 'transport', failureEvidence: ['rate-limited'] },
    { failure: 'transport', failureEvidence: ['quota-exceeded'] },
    { failure: 'hard', failureEvidence: ['tool-error'] },
    { failure: 'soft', failureEvidence: ['soft-timeout'] },
    { failure: 'none', failureEvidence: [] },
  ]
  for (const overrides of battery) {
    const current = state(overrides)
    const signal = signalByKind(signalsFor(overrides), 'failure.transport')
    assert.equal(signal?.value, matches('transport', current), JSON.stringify(overrides))
  }
})

test('parity: thresholded context.pressure tracks the context-pressure rule', () => {
  const battery: Array<Partial<TrajectoryState> & { expect: boolean }> = [
    { contextTokens: 950, contextWindow: 1_000, expect: true },
    { contextTokens: 900, contextWindow: 1_000, expect: false },
    { contextTokens: 100, contextWindow: 1_000, expect: false },
    { contextTokens: undefined, contextWindow: 1_000, expect: false },
    { contextTokens: 100, contextWindow: undefined, expect: false },
  ]
  for (const { expect, ...overrides } of battery) {
    const current = state(overrides)
    assert.equal(matches('context-pressure', current), expect, JSON.stringify(overrides))
    const signal = signalByKind(signalsFor(overrides), 'context.pressure')
    assert.equal(signal !== undefined && Number(signal.value) > 0.9, expect, JSON.stringify(overrides))
  }
})

test('parity: progress.stalled tracks the stuck rule, failure.real implies failure', () => {
  const stuck = state({ repeatedFailure: true, failure: 'hard', failureEvidence: ['tool-error'], failureStreak: 2 })
  assert.equal(matches('stuck', stuck), true)
  const stuckSignals = deterministicSignals(stuck, SCOPE)
  assert.equal(signalByKind(stuckSignals, 'progress.stalled')?.value, true)
  assert.equal(signalByKind(stuckSignals, 'failure.real')?.value, true)

  const calm = state({})
  assert.equal(matches('stuck', calm), false)
  assert.equal(signalByKind(deterministicSignals(calm, SCOPE), 'progress.stalled'), undefined)

  const failing = state({ failure: 'hard', failureEvidence: ['tool-error'] })
  assert.equal(matches('failure', failing), true)
  assert.equal(signalByKind(deterministicSignals(failing, SCOPE), 'failure.real')?.value, true)
})

test('fuzzy failures stay absent for the Jev phase, clean rounds report false', () => {
  const soft = signalsFor({ failure: 'soft', failureEvidence: ['soft-warning'] })
  assert.equal(signalByKind(soft, 'failure.real'), undefined)
  const clean = signalsFor({ failure: 'none', failureEvidence: [] })
  assert.equal(signalByKind(clean, 'failure.real')?.value, false)
  assert.equal(signalByKind(clean, 'failure.transport')?.value, false)
})

test('verification rounds report completion truthfully, other rounds stay absent', () => {
  const passed = signalsFor({ roundKind: 'verification', failure: 'none' })
  assert.equal(signalByKind(passed, 'verification.complete')?.value, true)
  const failed = signalsFor({ roundKind: 'verification', failure: 'hard', failureEvidence: ['tool-error'] })
  assert.equal(signalByKind(failed, 'verification.complete')?.value, false)
  const other = signalsFor({ roundKind: 'implementation' })
  assert.equal(signalByKind(other, 'verification.complete'), undefined)
})

test('staleness fires only on an observed host rewrite', () => {
  assert.equal(signalByKind(signalsFor({ contextGeneration: 2 }), 'context.staleness')?.value, true)
  assert.equal(signalByKind(signalsFor({ contextGeneration: 0 }), 'context.staleness'), undefined)
  assert.equal(signalByKind(signalsFor({}), 'context.staleness'), undefined)
})

test('recomputed judgments for a round overwrite instead of duplicating', () => {
  const first = deterministicSignals(state({ failure: 'none', failureEvidence: [] }), SCOPE)[0]
  const second = deterministicSignals(state({ failure: 'none', failureEvidence: [] }), SCOPE)[0]
  assert.equal(first.id, second.id)
})
