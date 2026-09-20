import test from 'node:test'
import assert from 'node:assert/strict'
import { clearModelHealth, modelHealth, recordModelReceipt } from '../src/model-health.ts'

test('model receipt health records latency and demotes a failed model temporarily', () => {
  clearModelHealth()
  try {
    const failed = recordModelReceipt({
      harness: 'opencode',
      model: 'opencode/muse-spark-1.3-free',
      outcome: 'failed',
      latencyMs: 143,
      observedAt: 10_000,
    })
    assert.deepEqual(failed, {
      status: 'unavailable',
      sampleCount: 1,
      successCount: 0,
      failureCount: 1,
      lastOutcome: 'failed',
      lastLatencyMs: 143,
      observedAt: 10_000,
    })
    assert.equal(modelHealth('opencode', 'opencode/muse-spark-1.3-free', 10_000)?.status, 'unavailable')
    assert.equal(modelHealth('opencode', 'opencode/muse-spark-1.3-free', 70_001), undefined)
  } finally {
    clearModelHealth()
  }
})

test('an unverifiable receipt does not claim health or failure', () => {
  clearModelHealth()
  try {
    const observed = recordModelReceipt({
      harness: 'opencode',
      model: 'opencode/muse-spark-1.3-free',
      outcome: 'unverifiable',
      observedAt: 20_000,
    })
    assert.equal(observed.status, 'unknown')
    assert.equal(observed.sampleCount, 1)
    assert.equal(observed.successCount, 0)
    assert.equal(observed.failureCount, 0)
  } finally {
    clearModelHealth()
  }
})
