import test from 'node:test'
import assert from 'node:assert/strict'
import { benchmarkSemanticProfiles } from '../src/profiler.ts'
import type { SemanticEpisode } from '../src/types.ts'

test('10x semantic profiling stays bounded on repeated local paths', () => {
  const episodes: SemanticEpisode[] = Array.from({ length: 1_000 }, (_, index) => ({
    operation: `operation-${index % 20}`,
    model: index % 2 === 0 ? 'cheap' : 'mid',
    phase: 'live',
    result: index % 5 === 0 ? 'failed' : 'recovered',
    evidence: 'source-test',
  }))
  const result = benchmarkSemanticProfiles(episodes, 10)
  assert.equal(result.iterations, 10)
  assert.equal(result.inputEpisodes, 1_000)
  assert.equal(result.profileCount, 20)
  assert.equal(result.bounded, true)
})
