import test from 'node:test'
import assert from 'node:assert/strict'
import {
  explainSignal,
  isSignalFresh,
  MAX_SIGNALS_PER_SCOPE,
  signalProblem,
  SignalStore,
  type DecisionSignal,
} from '../src/signals.ts'

function signal(overrides: Partial<DecisionSignal> = {}): DecisionSignal {
  return {
    id: 'sig-1',
    kind: 'failure.real',
    value: true,
    confidence: 0.97,
    sessionId: 'session-a',
    source: 'deterministic',
    evidence: [{ kind: 'tool_result', id: 'tool_result_88' }],
    observedAt: 1_000,
    mode: 'observe',
    ...overrides,
  }
}

test('validation rejects unknown kinds, bad confidence and non-scalar values', () => {
  assert.equal(signalProblem(signal()), undefined)
  assert.equal(signalProblem(signal({ kind: 'vibes.high' as never })), 'unknown-kind')
  assert.equal(signalProblem(signal({ confidence: 1.4 })), 'bad-confidence')
  assert.equal(signalProblem(signal({ value: { nested: true } as never })), 'bad-value')
  assert.equal(signalProblem(signal({ value: 'x'.repeat(241) })), 'value-too-long')
  assert.equal(signalProblem(signal({ id: 'has spaces!' })), 'bad-id')
  assert.equal(signalProblem(signal({ mode: 'enforce' as never })), 'bad-mode')
})

test('emit rejects invalid signals without storing them', () => {
  const store = new SignalStore()
  assert.equal(store.emit(signal({ confidence: 2 }), 2_000), 'bad-confidence')
  assert.equal(store.size('session-a'), 0)
})

test('latest returns the freshest signal per kind and ignores the expired', () => {
  const store = new SignalStore()
  assert.equal(store.emit(signal({ id: 'old', observedAt: 1_000, expiresAt: 1_500 }), 1_200), undefined)
  assert.equal(store.emit(signal({ id: 'new', observedAt: 1_300 }), 1_400), undefined)
  assert.equal(store.latest('session-a', 'failure.real', undefined, 1_400)?.id, 'new')
  assert.equal(store.byId('session-a', 'old') !== undefined, true)
  assert.equal(isSignalFresh(store.byId('session-a', 'old') as DecisionSignal, 1_600), false)
})

test('scopes hold at most 64 signals; oldest spill first', () => {
  const store = new SignalStore()
  for (let index = 0; index < MAX_SIGNALS_PER_SCOPE + 10; index += 1) {
    const problem = store.emit(signal({ id: `sig-${index}`, observedAt: 1_000 + index }), 2_000)
    assert.equal(problem, undefined)
  }
  assert.equal(store.size('session-a'), MAX_SIGNALS_PER_SCOPE)
  assert.equal(store.byId('session-a', 'sig-0'), undefined)
  assert.notEqual(store.byId('session-a', `sig-${MAX_SIGNALS_PER_SCOPE + 9}`), undefined)
})

test('supersede flags predecessors without deleting the audit trail', () => {
  const store = new SignalStore()
  assert.equal(store.emit(signal({ id: 'first' }), 1_000), undefined)
  assert.equal(store.emit(signal({ id: 'second', supersedes: ['first'] }), 1_100), undefined)
  assert.equal(store.byId('session-a', 'first')?.superseded, true)
  assert.equal(store.byId('session-a', 'second')?.superseded, undefined)
})

test('explain renders decision, parents and source events', () => {
  const store = new SignalStore()
  store.emit(signal({ id: 'd184', kind: 'failure.real', value: true, confidence: 0.97 }), 1_000)
  store.emit(
    signal({
      id: 'd192',
      kind: 'coverage',
      value: 0.88,
      confidence: 0.9,
      dependsOn: ['d184'],
      evidence: [],
    }),
    1_100,
  )
  const lines = explainSignal(store, 'session-a', 'd192')
  assert.deepEqual(lines, [
    'coverage = 0.88 (0.9)',
    'because: failure.real = true (0.97)',
    'which depended on: tool_result tool_result_88',
  ])
})

test('explain survives missing parents and unknown ids', () => {
  const store = new SignalStore()
  assert.deepEqual(explainSignal(store, 'session-a', 'nope'), ['unknown signal nope'])
  store.emit(signal({ id: 'orphan', dependsOn: ['gone'] }), 1_000)
  assert.deepEqual(explainSignal(store, 'session-a', 'orphan'), [
    'failure.real = true (0.97)',
    'because: gone (not retained)',
    'evidence: tool_result tool_result_88',
  ])
})
