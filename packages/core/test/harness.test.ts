import test from 'node:test'
import assert from 'node:assert/strict'
import { planRound, trajectoryFromRound, type HarnessRound } from '../src/harness.ts'

const policy = {
  failure: 'strong',
  stuck: 'mid',
  'context-pressure': 'mid',
  transport: 'mid',
  'first-turn': 'mid',
  verification: 'mid',
  implementation: 'mid',
  exploration: 'cheap',
  unclassified: 'cheap',
}

const tiers = {
  cheap: { model: 'deepseek/deepseek-v4-flash', effort: 'high' },
  mid: { model: 'claude-sonnet-5', effort: 'high' },
  strong: { model: 'claude-opus-5', effort: 'high' },
}

function round(patch: Partial<HarnessRound>): HarnessRound {
  return {
    messageCount: 6,
    assistantTurns: 2,
    lastRole: 'tool',
    contextChars: 4000,
    hasTools: true,
    toolNames: ['read_file', 'grep', 'shell_command', 'edit_file'],
    calls: [],
    ...patch,
  }
}

test('a tool that reports its own failure escalates to the strong tier', () => {
  const state = trajectoryFromRound(
    round({
      calls: [
        {
          name: 'shell_command',
          args: '{"command":"npm test"}',
          failed: true,
          output: 'FAIL src/a.test.ts\nTests: 2 failed, 10 passed',
        },
      ],
    }),
  )
  assert.equal(state.roundKind, 'verification')
  assert.equal(state.failure, 'hard')
  const plan = planRound(state, policy, tiers)
  assert.equal(plan?.rule, 'failure')
  assert.equal(plan?.tier, 'strong')
  assert.equal(plan?.model, 'claude-opus-5')
  assert.equal(plan?.effort, 'high')
})

test('document text that mentions an error does not escalate a round', () => {
  const state = trajectoryFromRound(
    round({
      calls: [
        {
          name: 'read_file',
          args: '{"absolute_path":"/repo/src/constants.ts"}',
          failed: false,
          output: "export const STATES = ['OK', 'FAILED', 'PENDING']\nError: see docs",
        },
      ],
    }),
  )
  assert.equal(state.roundKind, 'exploration')
  assert.equal(state.failure, 'none')
  const plan = planRound(state, policy, tiers)
  assert.equal(plan?.rule, 'exploration')
  assert.equal(plan?.tier, 'cheap')
})

test('warnings alone register as soft without escalating', () => {
  const state = trajectoryFromRound(
    round({
      calls: [
        {
          name: 'shell_command',
          args: '{"command":"npm run build"}',
          failed: false,
          output: 'warning: deprecated flag in tsconfig',
        },
        {
          name: 'shell_command',
          args: '{"command":"npm run build"}',
          failed: false,
          output: 'deprecation: Retrying with legacy resolver',
        },
      ],
    }),
  )
  assert.equal(state.failure, 'soft')
  assert.equal(planRound(state, policy, tiers)?.tier, 'mid')
})

test('the first turn of a session routes to the mid tier', () => {
  const state = trajectoryFromRound(
    round({ assistantTurns: 0, lastRole: 'user', calls: [], contextChars: 1200 }),
  )
  assert.equal(state.roundKind, 'first-turn')
  const plan = planRound(state, policy, tiers)
  assert.equal(plan?.rule, 'first-turn')
  assert.equal(plan?.tier, 'mid')
})

test('an edit round routes to the implementation tier', () => {
  const state = trajectoryFromRound(
    round({ calls: [{ name: 'edit_file', args: '{"file_path":"/repo/src/a.ts"}', failed: false }] }),
  )
  assert.equal(state.roundKind, 'implementation')
  assert.equal(planRound(state, policy, tiers)?.tier, 'mid')
})

test('a tier with no catalog entry plans nothing rather than guessing', () => {
  const state = trajectoryFromRound(
    round({ calls: [{ name: 'grep', args: '{"pattern":"x"}', failed: false }] }),
  )
  assert.equal(planRound(state, policy, {}), undefined)
  assert.equal(planRound(state, policy, { cheap: { model: '' } }), undefined)
})

test('trajectory metrics come from the harness round', () => {
  const state = trajectoryFromRound(round({ messageCount: 42, assistantTurns: 9, contextChars: 3600 }))
  assert.equal(state.messageCount, 42)
  assert.equal(state.assistantTurns, 9)
  assert.equal(state.estimatedTokens, 1000)
  assert.equal(state.toolMessages, 0)
})

test('a second identical hard failure is marked repeated and routes to the stuck tier', () => {
  const first = trajectoryFromRound(
    round({ calls: [{ name: 'shell_command', args: '{"command":"npm test"}', failed: true, output: 'Tests: 2 failed' }] }),
  )
  assert.equal(first.failure, 'hard')
  assert.equal(first.repeatedFailure, false)
  assert.equal(first.failureStreak, 1)

  const second = trajectoryFromRound(
    round({ calls: [{ name: 'shell_command', args: '{"command":"npm test"}', failed: true, output: 'Tests: 2 failed' }] }),
    { failure: first.failure, failureEvidence: first.failureEvidence },
  )
  assert.equal(second.repeatedFailure, true)
  assert.equal(second.failureStreak, 2)
  // A repeated identical hard failure routes to the stuck tier, not another escalation.
  assert.equal(planRound(second, policy, tiers)?.rule, 'stuck')
})

test('evidence is allowlisted codes, never raw output excerpts', () => {
  const state = trajectoryFromRound(
    round({
      calls: [
        {
          name: 'read_file',
          args: '{"absolute_path":"/repo/secret.txt"}',
          failed: false,
          output: 'api_key=sk-live-abcdef1234567890\nError: not a real problem',
        },
      ],
    }),
  )
  assert.equal(state.failure, 'none')
  assert.ok(state.failureEvidence.every((code) => !code.includes('sk-live') && !code.includes('api_key')))
})

test('a tool-reported rate limit routes to transport, not strong', () => {
  const state = trajectoryFromRound(
    round({
      calls: [
        {
          name: 'shell_command',
          args: '{"command":"curl api"}',
          failed: true,
          output: 'HTTP 429 too many requests: rate limit exceeded',
        },
      ],
    }),
  )
  assert.equal(state.failure, 'transport')
  const plan = planRound(state, policy, tiers)
  assert.equal(plan?.rule, 'transport')
  assert.equal(plan?.tier, 'mid')
})
