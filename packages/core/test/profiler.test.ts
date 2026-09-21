import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateSemanticProfiles,
  backtestProfileCandidate,
  benchmarkSemanticProfiles,
  proposeProfileCandidate,
  promoteProfileCandidate,
  rollbackProfileCandidate,
  semanticEpisodeFromDecision,
} from '../src/profiler.ts'
import type { DecisionRecord, SemanticEpisode } from '../src/types.ts'

const episode = (patch: Partial<SemanticEpisode> = {}): SemanticEpisode => ({
  operation: 'typescript-debugging',
  model: 'sonnet',
  phase: 'live',
  result: 'recovered',
  evidence: 'source-test',
  verification: { status: 'passed', generation: 0 },
  coverage: { expected: 10, observed: 10, ratio: 1, source: 'explicit' },
  cost: 0.01,
  latencyMs: 100,
  ...patch,
})

test('semantic profiles aggregate local outcomes and keep unknown cost explicit', () => {
  const profiles = aggregateSemanticProfiles([
    episode(),
    episode({ result: 'failed', cost: undefined, evidence: 'live-runtime', coverage: { source: 'unknown' }, verification: { status: 'unknown' } }),
    episode({ operation: 'repo-search', model: 'deepseek', verification: { status: 'unknown' } }),
  ])
  const debugging = profiles.find((profile) => profile.operation === 'typescript-debugging')
  assert.ok(debugging)
  assert.equal(debugging.samples, 2)
  assert.equal(debugging.recovered, 1)
  assert.equal(debugging.failed, 1)
  assert.equal(debugging.verified, 1)
  assert.equal(debugging.costKnown, 1)
  assert.equal(debugging.coverageSamples, 1)
  assert.equal(debugging.confidence, 'low')
  assert.deepEqual(debugging.evidence, { fixture: 0, 'source-test': 1, ci: 0, 'live-runtime': 1 })
})

test('candidate lifecycle is shadow-first and promotion requires backtest gates', () => {
  const candidate = proposeProfileCandidate({
    id: 'candidate-1',
    operation: 'typescript-debugging',
    model: 'sonnet',
    episodes: [episode(), episode(), episode()],
  })
  assert.equal(candidate.status, 'shadow')
  const rejected = promoteProfileCandidate(candidate)
  assert.equal(rejected.status, 'rejected')
  const backtested = backtestProfileCandidate(candidate, { passed: true, holdoutPassed: true })
  assert.equal(backtested.status, 'backtested')
  assert.equal(promoteProfileCandidate(backtested).status, 'active')
  assert.equal(rollbackProfileCandidate(backtested, 'fixture-run-1').status, 'rolled-back')
  const underSampled = proposeProfileCandidate({ id: 'candidate-2', operation: 'typescript-debugging', model: 'sonnet', episodes: [episode()] })
  assert.equal(promoteProfileCandidate(backtestProfileCandidate(underSampled, { passed: true, holdoutPassed: true })).status, 'rejected')
})

test('decision rows become bounded local episodes without trusting invalid state', () => {
  const record = {
    rule: 'verification',
    upstreamModel: 'model-a',
    outcome: 'transport',
    state: null,
  } as unknown as DecisionRecord
  const result = semanticEpisodeFromDecision(record)
  assert.equal(result.operation, 'verification')
  assert.equal(result.result, 'unknown')
  assert.equal(result.evidence, 'live-runtime')
})

test('ten deterministic profile passes stay bounded', () => {
  const benchmark = benchmarkSemanticProfiles(Array.from({ length: 100 }, (_, index) => episode({ operation: `operation-${index % 8}` })), 10)
  assert.equal(benchmark.iterations, 10)
  assert.equal(benchmark.inputEpisodes, 100)
  assert.equal(benchmark.profileCount, 8)
  assert.equal(benchmark.bounded, true)
})
