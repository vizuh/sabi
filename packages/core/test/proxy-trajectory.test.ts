import test from 'node:test'
import assert from 'node:assert/strict'
import { route } from '../src/router.ts'
import type { SabiConfig } from '../src/types.ts'

const config: SabiConfig = {
  upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1' } },
  models: {
    cheap: { upstream: 'mock', model: 'm-cheap', contextWindow: 10_000 },
    mid: { upstream: 'mock', model: 'm-mid', contextWindow: 20_000 },
    strong: { upstream: 'mock', model: 'm-strong', contextWindow: 30_000 },
  },
  aliases: { 'sabi-code': 'auto' },
  policy: {
    failure: 'strong',
    stuck: 'mid',
    'context-pressure': 'mid',
    'first-turn': 'mid',
    verification: 'mid',
    implementation: 'mid',
    exploration: 'cheap',
    unclassified: 'cheap',
  },
}

const system = { role: 'system', content: 'agent' }
const user = { role: 'user', content: 'keep going' }

function failingBody() {
  return {
    model: 'sabi-code',
    messages: [
      system,
      user,
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
    ],
  }
}

test('a measured context past 90% of the smallest declared window routes context-pressure', () => {
  const body = {
    model: 'sabi-code',
    messages: [
      system,
      { role: 'user', content: 'find it' },
      { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{}' } }] },
      { role: 'tool', content: '2 matches' },
    ],
  }
  const decision = route(body, config, { measuredContextTokens: 9500 })
  assert.equal(decision.rule, 'context-pressure')
  assert.equal(decision.tier, 'mid')
  assert.equal(decision.state.contextWindow, 10_000)
  assert.equal(decision.state.contextKnown, true)
})

test('context-pressure stays unreachable when any reachable window is unknown', () => {
  const partial: SabiConfig = {
    ...config,
    models: { ...config.models, strong: { upstream: 'mock', model: 'm-strong' } },
  }
  const decision = route(
    {
      model: 'sabi-code',
      messages: [system, user, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'more context please' }],
    },
    partial,
    { measuredContextTokens: 900_000 },
  )
  assert.equal(decision.state.contextWindow, undefined)
  assert.notEqual(decision.rule, 'context-pressure')
})

test('a consecutive hard failure for a tracked session routes stuck instead of escalating', () => {
  const first = route(failingBody(), config)
  assert.equal(first.rule, 'failure')
  assert.equal(first.tier, 'strong')
  assert.equal(first.state.failureStreak, 1)

  const second = route(failingBody(), config, {
    previousFailure: first.state.failure,
    previousFailureStreak: first.state.failureStreak,
  })
  assert.equal(second.state.repeatedFailure, true)
  assert.equal(second.rule, 'stuck')
  assert.equal(second.tier, 'mid')
})

test('an unattributed hard failure never claims a streak', () => {
  const decision = route(failingBody(), config)
  assert.equal(decision.rule, 'failure')
  assert.equal(decision.state.repeatedFailure, false)
})

test('a non-hard previous round does not make the next hard round stuck', () => {
  const decision = route(failingBody(), config, { previousFailure: 'none', previousFailureStreak: 0 })
  assert.equal(decision.rule, 'failure')
  assert.equal(decision.state.repeatedFailure, false)
})
