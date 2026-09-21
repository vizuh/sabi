import test from 'node:test'
import assert from 'node:assert/strict'
import { applyJudge, buildJudgeEvidence, buildJudgeState, JUDGE_QUESTIONS, judgeTriggers } from '../src/judge.ts'
import { hashIdentity } from '../src/log.ts'
import { route } from '../src/router.ts'
import type { RecoveryProfile } from '../src/recovery.ts'
import type { RouteDecision, SabiConfig } from '../src/types.ts'

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
  const state = buildJudgeState(failingBody(), decision, 6000, { includeSnippets: true }) as Record<string, unknown>
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
  const bounded = buildJudgeState(huge, route(huge, base), 6000, { includeSnippets: true })
  assert.ok(JSON.stringify(bounded).length <= 6000, 'state must respect maxStateChars')
})

test('judge state is content-free by default: no raw prompts, excerpts or clear tool names', () => {
  const decision = route(failingBody(), base)
  const state = buildJudgeState(failingBody(), decision, 6000) as Record<string, unknown>
  const serialized = JSON.stringify(state)
  assert.ok(!serialized.includes('run the tests'), 'raw instruction must not leave by default')
  assert.ok(!serialized.includes('2 failed'), 'raw tool excerpt must not leave by default')
  assert.ok(!serialized.includes('shell_command'), 'clear tool names must not leave by default')
  const tool = state.last_tool as Record<string, unknown>
  assert.equal(tool.result_excerpt, '')
  assert.match(String(tool.result_excerpt_sha256), /^[a-f0-9]{64}$/)
  assert.ok((tool.result_excerpt_chars as number) > 0)
  assert.match(String(state.last_instruction_sha256), /^[a-f0-9]{64}$/)
  // Tool identity keeps the same hashed invariant the decision log uses.
  assert.deepEqual(tool.names, [hashIdentity('tool', 'shell_command')])
  assert.ok(!(state.available_tools as string[]).includes('shell_command'))
})

test('telemetry.captureSnippets also opts the judge into raw excerpts', () => {
  const decision = route(failingBody(), base)
  const state = buildJudgeState(failingBody(), decision, 6000, { captureSnippets: true }) as Record<string, unknown>
  assert.match(String(state.last_instruction), /run the tests/)
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

// A decisive profile: 'mid' (the deterministic fallback for this failingBody) recovers far more
// often, with high confidence, than 'strong' (the incumbent) does.
const decisiveProfile: RecoveryProfile = new Map([
  ['strong::m-strong', { recoveries: 5, nonRecoveries: 25 }],  // pHat = 0.167, n = 30
  ['mid::m-mid', { recoveries: 29, nonRecoveries: 1 }],         // pHat = 0.967, n = 30, wilsonLower well above 0.167
])
const indecisiveProfile: RecoveryProfile = new Map([
  ['strong::m-strong', { recoveries: 5, nonRecoveries: 10 }],  // n = 15, below the n=30 gate
  ['mid::m-mid', { recoveries: 14, nonRecoveries: 1 }],         // n = 15, below the n=30 gate
])

test('ambiguous + a decisive local recovery profile declines the escalation', () => {
  const { decision: next, record } = applyJudge(
    route(failingBody(), base),
    base,
    { realProblem: 0.45, difficulty: 'standard', difficultyConfidence: 0.9 },
    decisiveProfile,
  )
  assert.equal(next.tier, 'mid')
  assert.equal(record.overridden, true)
  assert.equal(record.direction, 'down')
  assert.match(String(record.note), /declined via local recovery rate/)
})

test('ambiguous + a profile below the minimum sample size behaves exactly like no profile at all', () => {
  const withProfile = applyJudge(
    route(failingBody(), base),
    base,
    { realProblem: 0.45, difficulty: 'standard', difficultyConfidence: 0.9 },
    indecisiveProfile,
  )
  const without = applyJudge(route(failingBody(), base), base, {
    realProblem: 0.45,
    difficulty: 'standard',
    difficultyConfidence: 0.9,
  })
  assert.equal(withProfile.decision.tier, without.decision.tier)
  assert.equal(withProfile.decision.tier, 'strong')
  assert.equal(withProfile.record.note, without.record.note)
})

test('a decisive profile never overrides a confident veto or a confident confirm', () => {
  const veto = applyJudge(
    route(failingBody(), base),
    base,
    { realProblem: 0.05, difficulty: 'standard', difficultyConfidence: 0.9 },
    decisiveProfile,
  )
  assert.equal(veto.decision.tier, 'mid') // vetoed to the deterministic fallback, same as without a profile
  assert.match(veto.decision.reason, /jev vetoed escalation/)
  assert.doesNotMatch(String(veto.record.note), /local recovery rate/)

  const confirm = applyJudge(
    route(failingBody(), base),
    base,
    { realProblem: 0.93, difficulty: 'demanding', difficultyConfidence: 0.9 },
    decisiveProfile,
  )
  assert.equal(confirm.decision.tier, 'strong')
  assert.equal(confirm.record.overridden, false)
})

test('a decisive profile never fires on an unclassified/difficulty round', () => {
  const { decision: next, record } = applyJudge(
    route(unclassifiedBody(), base),
    base,
    { realProblem: 0.5, difficulty: 'demanding', difficultyConfidence: 0.91 },
    decisiveProfile,
  )
  assert.equal(next.tier, 'strong') // difficulty override to strong, unaffected by the profile
  assert.doesNotMatch(String(record.note), /local recovery rate/)
})

test('a decline whose fallback rule is "unclassified" is not re-processed by the difficulty block', () => {
  // decideTier(state, policy, {exclude:['failure']}) falls through to the 'unclassified' catch-all
  // whenever roundKind is 'unclassified' and no other condition matches — a real, reachable case
  // (an unrecognized tool name with hard-failure evidence), not a contrived one.
  const decision: RouteDecision = {
    alias: 'sabi-code',
    mode: 'auto',
    rule: 'failure',
    tier: 'strong',
    reason: 'failure evidence: fail-marker',
    model: 'strong',
    upstream: 'mock',
    upstreamModel: 'm-strong',
    state: {
      messageCount: 4,
      assistantTurns: 2,
      toolMessages: 1,
      lastRole: 'tool',
      contextChars: 100,
      estimatedTokens: 100,
      hasTools: true,
      toolNames: ['custom_tool'],
      lastToolNames: ['custom_tool'],
      roundKind: 'unclassified',
      failure: 'hard',
      failureEvidence: ['fail-marker'],
    },
  }
  const profile: RecoveryProfile = new Map([
    ['strong::m-strong', { recoveries: 5, nonRecoveries: 25 }], // pHat 0.167, n=30
    ['cheap::m-cheap', { recoveries: 29, nonRecoveries: 1 }], // pHat 0.967, n=30 — decisive vs strong
  ])
  const { decision: next, record } = applyJudge(
    decision,
    base,
    { realProblem: 0.45, difficulty: 'demanding', difficultyConfidence: 0.95 }, // would push to 'strong' if the guard failed
    profile,
  )
  assert.equal(next.rule, 'unclassified', 'the fallback rule really is unclassified in this case')
  assert.equal(next.tier, 'cheap', 'the recovery decline must stand, not get overwritten by the difficulty block')
  assert.equal(record.overridden, true)
  assert.equal(record.direction, 'down')
  assert.match(String(record.note), /declined via local recovery rate/)
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
      // Declared cheap-first on purpose: the fallback must still pick the cheapest priced
      // tier ('mid'), proving it does not depend on JSON declaration order.
      cheap: { upstream: 'mock', model: 'm-cheap', cost: { input: 5, output: 5 } },
      mid: { upstream: 'mock', model: 'm-mid', cost: { input: 0.1, output: 0.1 } },
      strong: { upstream: 'down', model: 'm-strong', cost: { input: 1, output: 1 } },
    },
    aliases: { 'sabi-code': 'auto' },
    policy: base.policy,
    judge: base.judge,
  }
  const decision = route(unclassifiedBody(), config)
  assert.equal(decision.tier, 'cheap')
  // Difficulty=demanding would normally escalate to 'strong', but its upstream is disabled;
  // the fallback is the cheapest enabled/capable tier ('mid'), not the first-declared one.
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

test('the question set batches two nouls and one choice question in a single call', () => {
  assert.equal(JUDGE_QUESTIONS.real_problem.type, 'noul')
  assert.equal(JUDGE_QUESTIONS.difficulty.type, 'choice')
  assert.equal(JUDGE_QUESTIONS.evidence_redundant.type, 'noul')
  assert.deepEqual(Object.keys(JUDGE_QUESTIONS.difficulty.criteria).sort(), ['demanding', 'standard', 'trivial'])
  assert.match(JUDGE_QUESTIONS.evidence_redundant.instructions, /redundant/)
})

test('a host compaction reaches the judge state so a stale verdict cannot be reused', () => {
  const decision = route(failingBody(), base, { measuredContextTokens: 50_000, contextGeneration: 3 })
  assert.equal(decision.state.contextKnown, true)
  const state = buildJudgeState(failingBody(), decision, 6000) as Record<string, unknown>
  assert.equal((state.round as Record<string, unknown>).context_generation, 3)
  // The same conversation without a boundary carries generation 0, so the two judge states
  // hash differently and a cached verdict from before the rewrite cannot be served after it.
  // (Unattributed requests have no session continuity: 0 documents "no boundary observed".)
  const plain = buildJudgeState(failingBody(), route(failingBody(), base), 6000) as Record<string, unknown>
  assert.equal((plain.round as Record<string, unknown>).context_generation, 0)
})

test('the shadow evidence answer is recorded and never changes the route', () => {
  const decision = route(failingBody(), base)
  const withoutShadow = applyJudge(decision, base, { realProblem: 0.9, difficulty: 'standard', difficultyConfidence: 0.9 })
  const withShadow = applyJudge(decision, base, {
    realProblem: 0.9,
    difficulty: 'standard',
    difficultyConfidence: 0.9,
    evidenceRedundant: 0.97,
  })
  assert.equal(withShadow.record.evidenceRedundant, 0.97)
  assert.equal(withoutShadow.record.evidenceRedundant, undefined)
  assert.equal(withShadow.decision.tier, withoutShadow.decision.tier)
  assert.equal(withShadow.decision.rule, withoutShadow.decision.rule)
  assert.equal(withShadow.record.overridden, false)
})

test('judge evidence uses bounded state-conditioned slots and explicit unknowns', () => {
  const body = failingBody()
  const decision = route(body, base, { contextGeneration: 2 })
  const evidence = buildJudgeEvidence(body, decision, 1200)
  assert.equal(evidence.failure.value, undefined)
  assert.equal(evidence.intent.status, 'observed')
  assert.equal(evidence.mutation.status, 'unknown')
  assert.ok(evidence.omitted.includes('mutation'))
  assert.ok(JSON.stringify(evidence).length <= 1200)
})

test('transport and invalid receipt gates bypass judge invocation', () => {
  const transport = route({
    model: 'sabi-code',
    messages: [system, { role: 'user', content: 'continue' }, { role: 'tool', content: 'HTTP 429 rate limit' }],
  }, base)
  assert.equal(judgeTriggers(transport, base.judge!), false)

  const invalid = route({
    model: 'sabi-code',
    messages: [system, { role: 'user', content: 'fix' }],
    verificationReceipt: { id: '', status: 'passed', source: 'harness', generation: 0 },
  }, base)
  assert.equal(invalid.state.verification?.reason, 'invalid-receipt')
  assert.equal(judgeTriggers(invalid, base.judge!), false)
})

test('judge recovery suggestions are accepted only when code-generated actions are valid', () => {
  const decision = route(unclassifiedBody(), base)
  const accepted = applyJudge(decision, base, { recoveryAction: 'fresh-context' })
  assert.equal(accepted.decision.recovery?.action, 'fresh-context')
  assert.equal(accepted.decision.recovery?.source, 'judge')

  const rejected = applyJudge(decision, base, { recoveryAction: 'run-arbitrary-command' })
  assert.equal(rejected.decision.recovery?.action, decision.recovery?.action)
  assert.equal(rejected.decision.recovery?.source, decision.recovery?.source)
})
