import test from 'node:test'
import assert from 'node:assert/strict'
import { runConformance, summarizeConformance } from '../src/conformance.ts'
import type { ConformanceFixture } from '../src/conformance.ts'
import type { TrajectoryIR } from '../src/types.ts'

/**
 * Shared conformance suite (spec 005 US4, T031). Every adapter runs the same
 * checks; fixture adapters prove the four named verdicts.
 */

function manifest(id: string) {
  return {
    id,
    kind: 'opencode' as const,
    version: '1.18.31',
    loop: 'proxy' as const,
  }
}

function ir(over: Partial<import('../src/types.ts').TrajectoryIR> = {}) {
  return {
    roundId: 'r-1',
    harness: 'opencode' as const,
    kind: 'implementation' as const,
    failureLevel: 'none' as const,
    evidence: [],
    untranslatable: [],
    ...over,
  }
}

const conformant: ConformanceFixture = {
  id: 'opencode-conformant',
  manifest: manifest('opencode'),
  ir: ir(),
}

const lossy: ConformanceFixture = {
  id: 'opencode-lossy',
  manifest: manifest('opencode'),
  ir: ir({ receipt: { operationId: '', source: 'test', status: 'unknown', startedAt: 0, durationMs: 0 } } as Partial<TrajectoryIR>),
  dropped: ['receipt.operationId'],
}

const leaking: ConformanceFixture = {
  id: 'opencode-leaking',
  manifest: manifest('opencode'),
  ir: ir({ receipt: { operationId: 'ok', source: 'test', status: 'unknown', startedAt: 0, durationMs: 0 } } as Partial<TrajectoryIR>),
  leaks: true,
}

const unstable: ConformanceFixture = {
  id: 'opencode-unstable',
  manifest: manifest('opencode'),
  ir: ir(),
  unstable: true,
}

test('a conformant fixture passes every check', () => {
  const report = runConformance(conformant)
  assert.equal(report.verdict, 'conformant')
  assert.ok(report.checks.every((c) => c.verdict === 'conformant'))
})

test('a lossy fixture is downgraded, not refused', () => {
  const report = runConformance(lossy)
  assert.equal(report.verdict, 'lossy')
  assert.ok(report.checks.some((c) => c.verdict === 'lossy'))
})

test('a leaking fixture is marked leaking, never conformant', () => {
  const report = runConformance(leaking)
  assert.equal(report.verdict, 'leaking')
})

test('an unstable fixture is marked unstable', () => {
  const report = runConformance(unstable)
  assert.equal(report.verdict, 'unstable')
})

test('summaries count verdicts across adapters', () => {
  const summary = summarizeConformance([
    runConformance(conformant),
    runConformance(lossy),
    runConformance(leaking),
    runConformance(unstable),
  ])
  assert.equal(summary.total, 4)
  assert.equal(summary.conformant, 1)
  assert.equal(summary.lossy, 1)
  assert.equal(summary.leaking, 1)
  assert.equal(summary.unstable, 1)
})

test('every report names its adapter and carries a reportId', () => {
  const report = runConformance(conformant)
  assert.equal(report.adapterId, 'opencode-conformant')
  assert.ok(report.reportId.startsWith('conf:opencode-conformant:'))
  assert.ok(report.generatedAt)
})

test('a fixture that drops declared fields records the downgrade', () => {
  const report = runConformance(lossy)
  assert.ok(report.checks.some((c) => c.checkId === 'declared-surfaces'))
})