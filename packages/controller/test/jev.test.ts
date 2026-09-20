import test from 'node:test'
import assert from 'node:assert/strict'
import { boundJevState } from '../src/jev.ts'

test('bounded Jev state omits raw diffs and stays within the configured limit', () => {
  const state = {
    request: 'review this routing decision',
    validActions: ['CONTINUE', 'DELEGATE'],
    inventory: {
      active: { id: 'session:current', context: 'current session' },
      existingSessions: Array.from({ length: 40 }, (_, index) => ({ id: `session:${index}`, context: 'x'.repeat(200) })),
      spawnCandidates: Array.from({ length: 40 }, (_, index) => ({ id: `harness:${index}`, catalog: 'catalog'.repeat(200) })),
    },
    handoff: { relevantDiff: 'raw diff must not reach Jev '.repeat(1000) },
  }

  const bounded = boundJevState(state, 1200)
  const serialized = JSON.stringify(bounded)
  assert.ok(serialized.length <= 1200)
  assert.doesNotMatch(serialized, /raw diff must not reach Jev/)
  assert.deepEqual(bounded.validActions, ['CONTINUE', 'DELEGATE'])
})

test('bounded Jev state honors configured limits below the default floor', () => {
  const bounded = boundJevState({ request: 'x'.repeat(1000), validActions: ['CONTINUE', 'ASK'] }, 200)
  assert.ok(JSON.stringify(bounded).length <= 200)
})
