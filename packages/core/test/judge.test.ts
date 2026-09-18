import test from 'node:test'
import assert from 'node:assert/strict'
import { applyJudge, buildJudgeState, JUDGE_QUESTIONS, judgeTriggers } from '../src/judge.ts'
import { route } from '../src/router.ts'
import type { SabiConfig } from '../src/types.ts'

const base: SabiConfig = {
  upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1' } },
  models: {
    cheap: { upstream: 'mock', model: 'm-cheap' },
    mid: { upstream: 'mock', model: 'm-mid' },
    strong: { upstream: 'mock', model: 'm-strong' },
  },
  aliases: { 'sabi-code': 'auto' },
  policy: {
    failure: 'strong',
    'first-turn': 'mid',
    verification: 'mid',
    implementation: 'mid',
    exploration: 'cheap',
    unclassified: 'cheap',
  },
  judge: { enabled: true, baseURL: 'https://api.typesafe.ai/v1' },
}

const system = { role: 'system', content: 'agent' }

function failingBody() {
  return {
    model: 'sabi-code',
    messages: [
      system,
      { role: 'user', content: 'run the tests' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
    ],
  }
}

function unclassifiedBody() {
  return {
    model: 'sabi-code',
    messages: [
      system,
      { role: 'user', content: 'check the containers' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"docker ps"}' } }] },
      { role: 'tool', content: 'CONTAINER ID  IMAGE  STATUS' },
    ],
  }
}

test('the judge is consulted for failure and unclassified rounds only', () => {
  const judge = base.judge!
  assert.equal(judgeTriggers(route(failingBody(), base), judge), true)
  assert.equal(judgeTriggers(route(unclassifiedBody(), base), judge), true)
  const exploration = route(
    {
      model: 'sabi-code',
      messages: [
        system,
        { role: 'user', content: 'find it' },
        { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{}' } }] },
        { role: 'tool', content: '2 matches' },
      ],
    },
    base,
  )
  assert.equal(judgeTriggers(exploration, judge), false)
  assert.equal(judgeTriggers(route(failingBody(), base), { ...judge, enabled: false }), false)
})

test('judge state carries the last instruction and tool excerpt within the budget', () => {
  const decision = route(failingBody(), base)
  const state = buildJudgeState(failingBody(), decision, 6000) as Record<string, unknown>
  assert.equal((state.last_instruction as string).includes('run the tests'), true)
  const tool = state.last_tool as { names: string[]; result_excerpt: string }
  assert.deepEqual(tool.names, ['shell_command'])
  assert.match(tool.result_excerpt, /2 failed/)

  const huge = {
    model: 'sabi-code',
    messages: [
      system,
      { role: 'user', content: 'x'.repeat(5000) },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'y'.repeat(50_000) },
    ],
  }
  const bounded = buildJudgeState(huge, route(huge, base), 6000)
  assert.ok(JSON.stringify(bounded).length <= 6000, 'state must respect maxStateChars')
})

test('a low real-problem probability vetoes the escalation', () => {
  const decision = route(failingBody(), base)
  assert.equal(decision.rule, 'failure')
  assert.equal(decision.tier, 'strong')
  const { decision: next, record } = applyJudge(decision, base, {
    realProblem: 0.05,
    difficulty: 'standard',
    difficultyConfidence: 0.9,
  })
  assert.equal(next.tier, 'mid')
  assert.equal(next.rule, 'verification')
  assert.match(next.reason, /jev vetoed escalation/)
  assert.equal(record.overridden, true)
  assert.equal(record.direction, 'down')
  assert.equal(record.finalTier, 'mid')
})

test('a high real-problem probability keeps the escalation', () => {
  const { decision: next, record } = applyJudge(route(failingBody(), base), base, {
    realProblem: 0.93,
    difficulty: 'demanding',
    difficultyConfidence: 0.9,
  })
  assert.equal(next.tier, 'strong')
  assert.equal(record.overridden, false)
  assert.equal(record.note, 'escalation confirmed')
})

test('an ambiguous probability keeps the deterministic escalation', () => {
  const { decision: next, record } = applyJudge(route(failingBody(), base), base, {
    realProblem: 0.45,
    difficulty: 'standard',
    difficultyConfidence: 0.9,
  })
  assert.equal(next.tier, 'strong')
  assert.match(String(record.note), /ambiguous/)
  assert.equal(record.overridden, false)
})

test('difficulty judgments retier unclassified rounds when confident', () => {
  const demanding = applyJudge(route(unclassifiedBody(), base), base, {
    realProblem: 0.5,
    difficulty: 'demanding',
    difficultyConfidence: 0.91,
  })
  assert.equal(demanding.decision.tier, 'strong')
  assert.equal(demanding.record.direction, 'up')
  assert.equal(demanding.record.overridden, true)

  const trivial = applyJudge(route(unclassifiedBody(), base), base, {
    realProblem: 0.5,
    difficulty: 'trivial',
    difficultyConfidence: 0.8,
  })
  assert.equal(trivial.decision.tier, 'cheap')
  assert.equal(trivial.record.overridden, false)
})

test('low confidence difficulty does not override the deterministic tier', () => {
  const { decision: next, record } = applyJudge(route(unclassifiedBody(), base), base, {
    realProblem: 0.5,
    difficulty: 'demanding',
    difficultyConfidence: 0.3,
  })
  assert.equal(next.tier, 'cheap')
  assert.equal(record.overridden, false)
  assert.match(String(record.note), /below threshold/)
})

test('a vetoed escalation reroutes around a disabled upstream instead of hard-failing later', () => {
  const config: SabiConfig = {
    upstreams: {
      mock: { baseURL: 'http://127.0.0.1:1/v1' },
      down: { baseURL: 'http://127.0.0.1:2/v1', enabled: false },
    },
    models: {
      cheap: { upstream: 'mock', model: 'm-cheap' },
      mid: { upstream: 'down', model: 'm-mid' },
      strong: { upstream: 'mock', model: 'm-strong' },
    },
    aliases: { 'sabi-code': 'auto' },
    policy: base.policy,
    judge: base.judge,
  }
  const decision = route(failingBody(), config)
  assert.equal(decision.tier, 'strong')
  // Veto fallback would normally land on 'mid' (verification), but its upstream is disabled.
  const { decision: next, record } = applyJudge(decision, config, {
    realProblem: 0.05,
    difficulty: 'standard',
    difficultyConfidence: 0.9,
  })
  assert.equal(next.tier, 'cheap')
  assert.equal(next.rule, 'availability')
  assert.match(next.reason, /cannot serve this round/)
  assert.equal(record.overridden, true)
})

test('a difficulty override reroutes around a disabled upstream instead of hard-failing later', () => {
  const config: SabiConfig = {
    upstreams: {
      mock: { baseURL: 'http://127.0.0.1:1/v1' },
      down: { baseURL: 'http://127.0.0.1:2/v1', enabled: false },
    },
    models: {
      mid: { upstream: 'mock', model: 'm-mid' },
      cheap: { upstream: 'mock', model: 'm-cheap' },
      strong: { upstream: 'down', model: 'm-strong' },
    },
    aliases: { 'sabi-code': 'auto' },
    policy: base.policy,
    judge: base.judge,
  }
  const decision = route(unclassifiedBody(), config)
  assert.equal(decision.tier, 'cheap')
  // Difficulty=demanding would normally escalate to 'strong', but its upstream is disabled;
  // 'mid' is declared before 'cheap' and is the first enabled/capable alternate.
  const { decision: next, record } = applyJudge(decision, config, {
    realProblem: 0.5,
    difficulty: 'demanding',
    difficultyConfidence: 0.91,
  })
  assert.equal(next.tier, 'mid')
  assert.equal(next.rule, 'availability')
  assert.match(next.reason, /cannot serve this round/)
  assert.equal(record.overridden, true)
})

test('the question set asks one noul and one choice question', () => {
  assert.equal(JUDGE_QUESTIONS.real_problem.type, 'noul')
  assert.equal(JUDGE_QUESTIONS.difficulty.type, 'choice')
  assert.deepEqual(Object.keys(JUDGE_QUESTIONS.difficulty.criteria).sort(), ['demanding', 'standard', 'trivial'])
})
