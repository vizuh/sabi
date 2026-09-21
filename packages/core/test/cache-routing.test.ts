import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheAwareRoute, cacheObservationFromUsage } from '../src/cache-routing.ts'

const state = {
  lastRole: 'tool',
  failure: 'none' as const,
  contextGeneration: 0,
  contextTokens: 1000,
  estimatedTokens: 900,
}

test('cache observations distinguish hit, miss and unknown', () => {
  assert.deepEqual(cacheObservationFromUsage({ promptTokens: 100, completionTokens: 10, cachedTokens: 40, totalTokens: 110 }), {
    status: 'hit', promptTokens: 100, cachedTokens: 40,
  })
  assert.equal(cacheObservationFromUsage({ promptTokens: 100, completionTokens: 10, cachedTokens: 0, totalTokens: 110 }).status, 'miss')
  assert.equal(cacheObservationFromUsage(undefined).status, 'unknown')
})

test('the same tool cycle keeps the current model', () => {
  const decision = cacheAwareRoute({
    state,
    plannedTier: 'strong',
    previousTier: 'cheap',
    // The first tool result follows an assistant message carrying tool_calls.
    previousLastRole: 'assistant',
    previousGeneration: 0,
    previousCache: { status: 'miss', promptTokens: 1000, cachedTokens: 0 },
  })
  assert.equal(decision.action, 'keep')
  assert.equal(decision.selectedTier, 'cheap')
  assert.equal(decision.phase, 'same-tool-cycle')
})

test('a warm cache blocks an unpriced phase switch', () => {
  const decision = cacheAwareRoute({
    state: { ...state, lastRole: 'assistant' },
    plannedTier: 'strong',
    previousTier: 'cheap',
    previousLastRole: 'tool',
    previousCache: { status: 'hit', promptTokens: 1000, cachedTokens: 800 },
    previousCost: { input: 1, cacheRead: 0.1, output: 1 },
    plannedCost: { input: 10, output: 10 },
  })
  assert.equal(decision.action, 'keep')
  assert.equal(decision.selectedTier, 'cheap')
  assert.equal(decision.reprocessTokens, 800)
  assert.ok((decision.cachePenalty ?? 0) > 0)
})

test('a measured cost gain can beat the cache penalty', () => {
  const decision = cacheAwareRoute({
    state: { ...state, lastRole: 'assistant' },
    plannedTier: 'cheap',
    previousTier: 'strong',
    previousLastRole: 'tool',
    previousCache: { status: 'hit', promptTokens: 1000, cachedTokens: 100 },
    previousCost: { input: 10, cacheRead: 1, output: 10 },
    plannedCost: { input: 1, output: 1 },
  })
  assert.equal(decision.action, 'switch')
  assert.equal(decision.selectedTier, 'cheap')
  assert.ok((decision.expectedGain ?? 0) > (decision.cachePenalty ?? 0))
})

test('a hard failure is an explicit escalation exception to cache affinity', () => {
  const decision = cacheAwareRoute({
    state: { ...state, failure: 'hard' },
    plannedTier: 'strong',
    previousTier: 'cheap',
    previousLastRole: 'tool',
    previousCache: { status: 'hit', promptTokens: 1000, cachedTokens: 900 },
  })
  assert.equal(decision.action, 'switch')
  assert.equal(decision.phase, 'failure')
  assert.equal(decision.selectedTier, 'strong')
})
