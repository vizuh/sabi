import test from 'node:test'
import assert from 'node:assert/strict'
import { toTrajectoryIR } from '../src/ir.ts'
import type { TrajectoryIR, TrajectoryState } from '../src/types.ts'

/**
 * Three harness shapes carrying the SAME observable state must produce the
 * same TrajectoryIR. This is the failing-first equivalence contract (spec 005
 * T002): the IR is the point where adapter-specific framing stops mattering.
 */

function baseState(over: Partial<TrajectoryState> = {}): TrajectoryState {
  return {
    messageCount: 6,
    assistantTurns: 2,
    toolMessages: 4,
    lastRole: 'tool',
    contextChars: 12000,
    estimatedTokens: 3000,
    hasTools: true,
    toolNames: ['read', 'edit'],
    lastToolNames: ['edit'],
    roundKind: 'implementation',
    failure: 'none',
    failureEvidence: [],
    ...over,
  }
}

function strip(ir: TrajectoryIR) {
  return {
    roundId: ir.roundId,
    kind: ir.kind,
    failureLevel: ir.failureLevel,
    evidence: ir.evidence,
    verification: ir.verification,
    capabilities: ir.capabilities,
    cache: ir.cache,
    receipt: ir.receipt,
    untranslatable: ir.untranslatable,
  }
}

test('proxy shape, mod shape and native shape map to the same IR', () => {
  const proxy = toTrajectoryIR({
    shape: 'proxy',
    roundId: 'r-1',
    harness: 'opencode',
    state: baseState(),
    known: { session: true, turn: true, capabilities: true },
  })
  const mod = toTrajectoryIR({
    shape: 'mod',
    roundId: 'r-1',
    harness: 'command-code',
    state: baseState(),
    known: { session: true, turn: true, capabilities: true },
  })
  const native = toTrajectoryIR({
    shape: 'native',
    roundId: 'r-1',
    harness: 'hermes',
    state: baseState(),
    known: { session: true, turn: true, capabilities: true },
  })

  // Everything except the harness label (which is an input, not a derived fact)
  // must be identical across shapes.
  assert.deepEqual(strip(proxy), strip(mod))
  assert.deepEqual(strip(proxy), strip(native))
  assert.equal(proxy.harness, 'opencode')
  assert.equal(mod.harness, 'command-code')
  assert.equal(native.harness, 'hermes')
})

test('an unknown harness reads as all-unknown, never as an invented default', () => {
  const ir = toTrajectoryIR({
    shape: 'native',
    roundId: 'r-2',
    harness: 'unknown',
    state: baseState({ failure: 'hard', failureEvidence: ['command-failed'] }),
    known: { session: false, turn: false, capabilities: false },
  })
  assert.equal(ir.harness, 'unknown')
  assert.deepEqual(ir.untranslatable, ['capabilities'])
  assert.equal(ir.capabilities, undefined)
})

test('untranslatable fields are listed, never silently dropped', () => {
  const ir = toTrajectoryIR({
    shape: 'proxy',
    roundId: 'r-3',
    harness: 'opencode',
    state: baseState(),
    known: { session: false, turn: false, capabilities: false },
  })
  assert.deepEqual(ir.untranslatable, ['capabilities'])
  assert.equal(ir.capabilities, undefined)
})

test('a hard failure with evidence carries the allowlisted code into the IR', () => {
  const ir = toTrajectoryIR({
    shape: 'mod',
    roundId: 'r-4',
    harness: 'command-code',
    state: baseState({
      failure: 'hard',
      failureEvidence: ['command-failed', 'nonzero-exit'],
    }),
    known: { session: true, turn: true, capabilities: true },
  })
  assert.equal(ir.failureLevel, 'hard')
  assert.deepEqual(ir.evidence, [
    { code: 'command-failed', source: 'harness', status: 'observed', contextGeneration: 0 },
    { code: 'nonzero-exit', source: 'harness', status: 'observed', contextGeneration: 0 },
  ])
})

test('an unallowlisted evidence code is refused, not normalized', () => {
  assert.throws(
    () => toTrajectoryIR({
      shape: 'native',
      roundId: 'r-5',
      harness: 'hermes',
      state: baseState({ failureEvidence: ['not-a-real-code'] }),
      known: { session: true, turn: true, capabilities: true },
    }),
    /not-a-real-code/,
  )
})