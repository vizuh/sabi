import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMeasuredContext,
  boundTrajectoryEvidence,
  buildScopeCoverage,
  completionStatus,
  extractTrajectoryState,
  isFullyVerified,
  parseTrajectoryEvidence,
  serializeDecisionRecord,
  strongestExecutionReceipt,
} from '../src/index.ts'
import type { ChatMessage, DecisionRecord, TrajectoryState } from '../src/types.ts'

const system: ChatMessage = { role: 'system', content: 'agent' }

function body(messages: ChatMessage[], extra: Record<string, unknown> = {}) {
  return { model: 'sabi-code', messages, ...extra }
}

test('a mutation needs current-generation verification and a summary cannot upgrade it', () => {
  const mutation = extractTrajectoryState(body([
    system,
    { role: 'user', content: 'fix it' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
    { role: 'tool', content: 'updated' },
  ]))
  assert.equal(mutation.verification?.status, 'needed')
  assert.equal(mutation.verification?.reason, 'mutation-without-receipt')

  const summary = extractTrajectoryState(body([{ role: 'user', content: 'tests pass' }], { summaryClaim: true }))
  assert.equal(summary.verification?.status, 'unknown')
  assert.equal(summary.verification?.reason, 'summary-without-receipt')
  assert.equal(summary.evidence?.[0]?.source, 'summary')
  assert.equal(isFullyVerified(summary.verification), false)
})

test('an explicit verifier receipt closes the same generation only', () => {
  const state = extractTrajectoryState(body([
    system,
    { role: 'user', content: 'fix it' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
    { role: 'tool', content: 'updated' },
  ], {
    verificationReceipt: { id: 'receipt-1', status: 'passed', source: 'harness', generation: 0 },
  }))
  assert.equal(state.verification?.status, 'passed')
  assert.equal(state.verification?.receiptId, 'receipt-1')
  applyMeasuredContext(state, { contextGeneration: 1 })
  assert.equal(state.verification?.status, 'unknown')
  assert.equal(state.verification?.reason, 'stale-generation')
})

test('host-provided generation is carried into additive trajectory state', () => {
  const state = extractTrajectoryState(body([{ role: 'user', content: 'continue' }], { contextGeneration: 3 }))
  assert.equal(state.contextGeneration, 3)
  assert.ok(state.evidence?.some((item) => item.code === 'context-boundary' && item.contextGeneration === 3))
})

test('coverage is explicit and bounded, while inferred coverage stays non-verifying', () => {
  const coverage = buildScopeCoverage({ expected: Array.from({ length: 20 }, (_, i) => `file-${i}`), observed: Array.from({ length: 13 }, (_, i) => `file-${i}`) })
  assert.equal(coverage.expected, 20)
  assert.equal(coverage.observed, 13)
  assert.equal(coverage.ratio, 0.65)
  assert.equal(coverage.source, 'explicit')
  assert.equal(completionStatus({ status: 'passed', generation: 0 }, coverage, 0), 'unknown')

  const inferred = buildScopeCoverage({ observed: ['a.ts'] })
  assert.equal(inferred.source, 'inferred')
  assert.equal(isFullyVerified({ status: 'passed', generation: 0 }, inferred, 0), false)
})

test('evidence serialization drops malformed and secret-like details and preserves bounded codes', () => {
  const values = boundTrajectoryEvidence([
    { code: 'mutation', source: 'tool', status: 'observed', contextGeneration: 0, detail: 'safe' },
    { code: 'not-allowlisted', source: 'tool', status: 'observed', contextGeneration: 0 },
    { code: 'summary-claim', source: 'summary', status: 'unverified', contextGeneration: 0, detail: 'sk-live-ABCDEF1234567890abcdef' },
  ])
  assert.deepEqual(values.map((item) => item.code), ['mutation', 'summary-claim'])
  assert.equal(values[1]?.detail, undefined)
  const encoded = JSON.stringify(values)
  assert.deepEqual(parseTrajectoryEvidence(encoded).map((item) => item.code), ['mutation', 'summary-claim'])
})

test('legacy decision records serialize with optional evidence fields only', () => {
  const state: TrajectoryState = {
    messageCount: 1,
    assistantTurns: 0,
    toolMessages: 0,
    lastRole: 'user',
    contextChars: 5,
    estimatedTokens: 2,
    hasTools: false,
    toolNames: [],
    lastToolNames: [],
    roundKind: 'first-turn',
    failure: 'none',
    failureEvidence: [],
  }
  const record = {
    ts: '2026-09-20T00:00:00.000Z',
    sessionId: 'legacy',
    alias: 'sabi-code',
    mode: 'auto' as const,
    rule: 'first-turn',
    tier: 'mid',
    reason: 'safe reason',
    upstream: 'mock',
    upstreamModel: 'mock-mid',
    stream: false,
    state,
    outcome: 'ok' as const,
  } satisfies DecisionRecord
  const encoded = serializeDecisionRecord(record)
  assert.ok(!encoded.includes('safe reason'))
  assert.ok(!encoded.includes('sk-live-'))
  assert.ok(JSON.parse(encoded).state)
})

test('an execution receipt drives a passed verification with receipt linkage', () => {
  const state = extractTrajectoryState(body([
    system,
    { role: 'user', content: 'fix it' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
    { role: 'tool', content: 'updated' },
  ], {
    executionReceipt: {
      operationId: 'build-9',
      source: 'build',
      status: 'passed',
      startedAt: 1,
      durationMs: 100,
    },
    generation: 0,
  }))
  assert.equal(state.verification?.status, 'passed')
  assert.equal(state.verification?.receiptId, 'build-9')
  assert.equal(state.verification?.reason, 'verification-receipt')
  assert.equal(state.evidence?.some((e) => e.code === 'verification-receipt' && e.status === 'verified'), true)
  assert.equal(isFullyVerified(state.verification, undefined, 0), true)
})

test('a failed execution receipt produces a failed verification', () => {
  const state = extractTrajectoryState(body([
    system,
    { role: 'user', content: 'fix it' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
    { role: 'tool', content: 'updated' },
  ], {
    executionReceipt: {
      operationId: 'build-10',
      source: 'test',
      status: 'failed',
      startedAt: 1,
      durationMs: 80,
      exitCode: 2,
    },
    generation: 0,
  }))
  assert.equal(state.verification?.status, 'failed')
  assert.equal(state.verification?.receiptId, 'build-10')
})

test('an unknown-status execution receipt does not close verification', () => {
  const state = extractTrajectoryState(body([
    system,
    { role: 'user', content: 'fix it' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
    { role: 'tool', content: 'updated' },
  ], {
    executionReceipt: {
      operationId: 'op-11',
      source: 'sandbox',
      status: 'unknown',
      startedAt: 1,
      durationMs: 0,
    },
    generation: 0,
  }))
  assert.equal(state.verification?.status, 'unknown')
})

test('a new-generation compaction invalidates a prior passed execution receipt', () => {
  const state = extractTrajectoryState(body([
    system,
    { role: 'user', content: 'fix it' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
    { role: 'tool', content: 'updated' },
  ], {
    executionReceipt: {
      operationId: 'build-12',
      source: 'build',
      status: 'passed',
      startedAt: 1,
      durationMs: 100,
    },
    generation: 0,
  }))
  assert.equal(state.verification?.status, 'passed')
  applyMeasuredContext(state, { contextGeneration: 1 })
  assert.equal(state.verification?.status, 'unknown')
  assert.equal(state.verification?.reason, 'stale-generation')
})

test('strongestExecutionReceipt prefers passed over failed for the same id', () => {
  const receipts = [
    { operationId: 'op', source: 'test' as const, status: 'failed' as const, startedAt: 1, durationMs: 1, exitCode: 1 },
    { operationId: 'op', source: 'build' as const, status: 'passed' as const, startedAt: 2, durationMs: 2 },
    { operationId: 'op', source: 'lint' as const, status: 'failed' as const, startedAt: 3, durationMs: 3, exitCode: 2 },
    { operationId: 'other', source: 'build' as const, status: 'passed' as const, startedAt: 4, durationMs: 4 },
  ]
  const chosen = strongestExecutionReceipt(receipts, 'op')
  assert.equal(chosen?.status, 'passed')
  assert.equal(strongestExecutionReceipt(receipts, 'missing'), undefined)
})
