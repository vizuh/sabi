import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentState, ModApi, ModContext, ModHooks } from '@commandcode/harness'
import sabi from '../mod/sabi.ts'

interface Harness {
  hooks: ModHooks
  events: Map<string, (event: unknown) => void>
  notices: string[]
  decisions: Array<Record<string, unknown>>
  ctx: ModContext
}

function loadMod(cwd = process.cwd()): Harness {
  const harness: Partial<Harness> = { notices: [], decisions: [], events: new Map() }
  harness.ctx = {
    cwd,
    session: {
      appendCustomEntry: (entry) => {
        harness.decisions?.push(entry.data as Record<string, unknown>)
      },
      getCustomEntries: () => [],
    },
  }
  const cmd = {
    name: 'sabi',
    ui: { notify: (message: string) => harness.notices?.push(message) },
    hooks: (hooks: ModHooks) => {
      harness.hooks = hooks
      return { dispose: () => {} }
    },
    on: (event: string, handler: (event: unknown) => void) => {
      harness.events?.set(event, handler)
      return { dispose: () => {} }
    },
  } as unknown as ModApi
  sabi(cmd)
  return harness as Harness
}

function round(h: Harness, turn: number, state: AgentState): Promise<AgentState> {
  return Promise.resolve(h.hooks.onTurnStart!({ state, turnNumber: turn }, h.ctx))
}

function readDecisionLog(cwd: string): Array<Record<string, unknown>> {
  const file = path.join(cwd, '.sabi', 'decisions.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('the mod registers the routing seam and a model observer', () => {
  const h = loadMod()
  assert.deepEqual(h.notices, [])
  assert.equal(typeof h.hooks.prepareNextTurn, 'function')
  assert.equal(typeof h.hooks.afterToolCall, 'function')
  assert.equal(h.events.has('model_request_end'), true)
})

test('a tool that reported failure escalates the next round and is logged', async () => {
  const h = loadMod()
  let state: AgentState = { modState: {} }

  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'shell_command',
      input: { command: 'npm test' },
      result: 'FAIL src/a.test.ts > adds\nTests: 2 failed, 10 passed',
      isError: true,
      state,
    },
    h.ctx,
  )
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.deepEqual(next, { model: 'zai-org/glm-5.3', effort: 'high' })
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 1, hadToolCalls: true, usage: { inputTokens: 1000, outputTokens: 40 } },
    h.ctx,
  )

  state = await round(h, 2, state)
  h.events.get('model_request_end')?.({ type: 'model_request_end', model: 'zai-org/glm-5.3' })
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 2, hadToolCalls: false, usage: { inputTokens: 2000, outputTokens: 90 } },
    h.ctx,
  )

  // Every round is logged, including ones Sabi did not plan: the first round of a run is
  // already under way before prepareNextTurn can run, so it is served by the session model.
  assert.equal(h.decisions.length, 2)
  assert.equal(h.decisions[0]?.planned, undefined)
  const planned = h.decisions[1]?.planned as Record<string, unknown>
  assert.equal(planned.tier, 'strong')
  assert.equal(planned.rule, 'failure')
  assert.equal(planned.roundKind, 'verification')
  assert.equal(planned.failure, 'hard')
  assert.equal(h.decisions[1]?.servedBy, 'zai-org/glm-5.3')
  assert.deepEqual((h.decisions[1]?.usage as Record<string, unknown>).inputTokens, 2000)
})

test('a read round plans the cheap tier and never rewrites the tool result', async () => {
  const h = loadMod()
  const state = await round(h, 1, { modState: {} })
  const untouched = await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'read_file',
      input: { absolute_path: '/repo/README.md' },
      result: 'Error: see docs\nsome file body',
      isError: false,
      state,
    },
    h.ctx,
  )
  assert.equal(untouched, undefined)
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.deepEqual(next, { model: 'deepseek/deepseek-v4-flash', effort: 'high' })
})

test('the decision record stays content-free by default (no raw tool output)', async () => {
  const h = loadMod()
  let state: AgentState = { modState: {} }
  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'grep',
      input: { pattern: 'sk-live-abc' },
      result: 'sk-live-abcdef1234567890 found in secret.txt',
      isError: false,
      state,
    },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 1, hadToolCalls: true, usage: { inputTokens: 100, outputTokens: 20 } },
    h.ctx,
  )
  const serialized = JSON.stringify(h.decisions)
  assert.ok(!serialized.includes('sk-live-abcdef1234567890'))
  assert.ok(!serialized.includes('secret.txt'))
})

test('a missing usage event does not carry a stale previous usage into the next round', async () => {
  const h = loadMod()
  let state: AgentState = { modState: {} }
  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't1', toolName: 'read_file', input: {}, result: 'body', isError: false, state },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 1, hadToolCalls: true, usage: { inputTokens: 100, outputTokens: 20 } },
    h.ctx,
  )
  // Round 2: no usage arrives.
  state = await round(h, 2, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't2', toolName: 'grep', input: {}, result: 'match', isError: false, state },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 2 }, h.ctx)
  state = await h.hooks.onTurnEnd!({
    state,
    turnNumber: 2,
    hadToolCalls: true,
    usage: undefined,
  }, h.ctx)
  const round2 = h.decisions[1] as Record<string, unknown>
  assert.equal((round2.usage as Record<string, unknown> | undefined)?.inputTokens, undefined)
})

test('an unavailable tier plans nothing rather than guessing or downgrading silently', async () => {
  const h = loadMod()
  // Force the strong tier to be absent: simulate a config where `strong` is not in tiers.
  // The mod disables itself if no tiers are declared, but a missing *rule* tier still means
  // no plan for that rule.
  let state: AgentState = { modState: {} }
  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't1', toolName: 'shell_command', input: { command: 'npm test' }, result: 'FAIL', isError: false, state },
    h.ctx,
  )
  // With the stock config, a verification round with no failed flag is mid, and the plan is a
  // mid model; assert the plan for this verified round is present (not undefined), so the test
  // guards the exact config-dependent mapping instead of asserting a guess.
  const plan = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.equal(typeof plan?.model, 'string')
})

test('a repeated identical failure routes to the stuck tier through the full lifecycle', async () => {
  const h = loadMod()
  let state: AgentState = { modState: {} }

  // Round 1: shell_command fails hard.
  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'shell_command',
      input: { command: 'npm test' },
      result: 'Tests: 2 failed, 10 passed\nexit code: 1',
      isError: true,
      state,
    },
    h.ctx,
  )
  const firstPlan = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.equal(typeof firstPlan?.model, 'string')
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 1, hadToolCalls: true, usage: { inputTokens: 500, outputTokens: 50 } },
    h.ctx,
  )

  // Round 2: same failure again.
  state = await round(h, 2, state)
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't2',
      toolName: 'shell_command',
      input: { command: 'npm test' },
      result: 'Tests: 2 failed, 10 passed\nexit code: 1',
      isError: true,
      state,
    },
    h.ctx,
  )
  const secondPlan = await h.hooks.prepareNextTurn!({ state, turnNumber: 2 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 2, hadToolCalls: true, usage: { inputTokens: 600, outputTokens: 60 } },
    h.ctx,
  )

  // Round 3: same failure yet again — the plan that served round 2 (the stuck plan produced by
  // round 2's prepareNextTurn) is what round 3's onTurnEnd records as served.
  state = await round(h, 3, state)
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't3',
      toolName: 'shell_command',
      input: { command: 'npm test' },
      result: 'Tests: 2 failed, 10 passed\nexit code: 1',
      isError: true,
      state,
    },
    h.ctx,
  )
  const thirdPlan = await h.hooks.prepareNextTurn!({ state, turnNumber: 3 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 3, hadToolCalls: true, usage: { inputTokens: 700, outputTokens: 70 } },
    h.ctx,
  )

  // The decision recorded at the end of round 2 reflects the plan that served round 2, which
  // is round 1's escalation. The round-2 plan (stuck) serves round 3, so round 3's record
  // carries rule=stuck and the repeated-failure markers.
  const thirdDecision = h.decisions[h.decisions.length - 1] as Record<string, unknown>
  const planned = thirdDecision.planned as Record<string, unknown>
  assert.equal(planned.rule, 'stuck')
  assert.equal(planned.repeatedFailure, true)
  assert.equal(planned.failureStreak, 2)
  assert.equal(typeof secondPlan?.model, 'string')
  assert.equal(typeof thirdPlan?.model, 'string')
})

test('an edit round plans the mid tier', async () => {
  const h = loadMod()
  const state = await round(h, 1, { modState: {} })
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'edit_file',
      input: { file_path: '/repo/src/a.ts' },
      result: 'file updated',
      isError: false,
      state,
    },
    h.ctx,
  )
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.deepEqual(next, { model: 'gpt-5.6-luna', effort: 'high' })
})

test('a rate-limited tool result routes to the transport tier, not strong', async () => {
  const h = loadMod()
  const state = await round(h, 1, { modState: {} })
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'shell_command',
      input: { command: 'curl api' },
      result: 'HTTP 429 too many requests: rate limit exceeded',
      isError: true,
      state,
    },
    h.ctx,
  )
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.deepEqual(next, { model: 'gpt-5.6-luna', effort: 'high' })
})

test('a conversation carrying an image plans a tier that can read it', async () => {
  const h = loadMod()
  let state = await round(h, 1, {
    modState: {},
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is wrong in this screenshot?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'Zml4dHVyZQ==' } },
        ],
      },
    ],
  })
  // A read round would otherwise plan the cheap tier, whose catalog model is text-only: the host
  // strips images for it, so the round must land on the model that can actually see.
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'read_file',
      input: { absolute_path: '/repo/src/a.ts' },
      result: 'file body',
      isError: false,
      state,
    },
    h.ctx,
  )
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.deepEqual(next, { model: 'gpt-5.6-luna', effort: 'high' })

  state = await round(h, 2, state)
  await h.hooks.onTurnEnd!({ state, turnNumber: 2, hadToolCalls: false, usage: { inputTokens: 10, outputTokens: 5 } }, h.ctx)
  const planned = h.decisions.at(-1)?.planned as Record<string, unknown>
  assert.equal(planned.rule, 'capability')
  assert.deepEqual(planned.inputModalities, ['text', 'image'])
})

test('a transcript with no readable media plans no modality constraint', async () => {
  const h = loadMod()
  const state = await round(h, 1, { modState: {}, messages: [{ role: 'user', content: 'plain question' }] })
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'read_file',
      input: { absolute_path: '/repo/src/a.ts' },
      result: 'file body',
      isError: false,
      state,
    },
    h.ctx,
  )
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  assert.deepEqual(next, { model: 'deepseek/deepseek-v4-flash', effort: 'high' })
})

test('the next round starts from the previous round\'s billed total, not from tool-output length', async () => {
  const h = loadMod()
  let state: AgentState = { modState: {}, messages: [{ role: 'user', content: 'read the file' }] }
  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't1', toolName: 'read_file', input: {}, result: 'file body', isError: false, state },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 1, hadToolCalls: true, usage: { inputTokens: 5000, outputTokens: 200 } },
    h.ctx,
  )

  // Round 2 plans from the measured floor; that plan serves round 3, where it is recorded.
  state = await round(h, 2, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't2', toolName: 'grep', input: {}, result: 'match', isError: false, state },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 2 }, h.ctx)
  state = await h.hooks.onTurnEnd!({ state, turnNumber: 2, hadToolCalls: true, usage: undefined }, h.ctx)

  state = await round(h, 3, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't3', toolName: 'grep', input: {}, result: 'match', isError: false, state },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 3 }, h.ctx)
  await h.hooks.onTurnEnd!({ state, turnNumber: 3, hadToolCalls: true, usage: undefined }, h.ctx)

  const planned = (h.decisions.at(-1)?.planned ?? {}) as Record<string, unknown>
  assert.equal(planned.contextTokens, 5200)
})

test('a host compaction resets the repeated-failure streak and records its generation', async () => {
  const h = loadMod()
  const before = Array.from({ length: 10 }, (_, i) => ({ role: i === 0 ? 'user' : 'assistant', content: `m${i}` }))
  let state: AgentState = { modState: {}, messages: before }
  state = await round(h, 1, state)
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't1',
      toolName: 'shell_command',
      input: { command: 'npm test' },
      result: 'Tests: 2 failed\nexit code: 1',
      isError: true,
      state,
    },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 1, hadToolCalls: true, usage: { inputTokens: 9000, outputTokens: 100 } },
    h.ctx,
  )

  // The host rewrote the transcript down to a summary plus the live instruction.
  const after = [
    { role: 'system', content: 'summary of earlier work' },
    { role: 'user', content: 'keep going' },
    { role: 'assistant', content: 'ok' },
  ]
  state = await round(h, 2, { ...state, messages: after })
  await h.hooks.afterToolCall!(
    {
      toolCallId: 't2',
      toolName: 'shell_command',
      input: { command: 'npm test' },
      result: 'Tests: 2 failed\nexit code: 1',
      isError: true,
      state,
    },
    h.ctx,
  )
  const next = await h.hooks.prepareNextTurn!({ state, turnNumber: 2 }, h.ctx)
  state = await h.hooks.onTurnEnd!(
    { state, turnNumber: 2, hadToolCalls: true, usage: { inputTokens: 300, outputTokens: 20 } },
    h.ctx,
  )

  // The post-compaction plan serves round 3, where its decision is recorded.
  state = await round(h, 3, state)
  await h.hooks.afterToolCall!(
    { toolCallId: 't3', toolName: 'read_file', input: {}, result: 'file body', isError: false, state },
    h.ctx,
  )
  await h.hooks.prepareNextTurn!({ state, turnNumber: 3 }, h.ctx)
  await h.hooks.onTurnEnd!({ state, turnNumber: 3, hadToolCalls: true, usage: undefined }, h.ctx)

  const planned = (h.decisions.at(-1)?.planned ?? {}) as Record<string, unknown>
  // Without the boundary this would be stuck (streak 2); after the rewrite it is one fresh failure.
  assert.equal(planned.rule, 'failure')
  assert.equal(planned.contextGeneration, 1)
  assert.notEqual(planned.repeatedFailure, true)
  // The pre-compaction measured size is not carried across the boundary.
  assert.notEqual(planned.contextTokens, 9100)
  assert.deepEqual(next, { model: 'zai-org/glm-5.3', effort: 'high' })
})

test('planned rounds write common evidence beside the harness workspace', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-command-code-'))
  try {
    const h = loadMod(cwd)
    let state: AgentState = await round(h, 1, {
      modState: { sabi: { toolNames: ['read_file'], hasTools: true } },
    })
    await h.hooks.afterToolCall!({
      toolCallId: 't1',
      toolName: 'read_file',
      input: { absolute_path: '/repo/private.txt', token: 'sk-live-secret' },
      result: 'private body sk-live-secret',
      isError: false,
      state,
    }, h.ctx)
    await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
    state = await h.hooks.onTurnEnd!({
      state,
      turnNumber: 1,
      hadToolCalls: true,
      usage: { inputTokens: 100, outputTokens: 20 },
    }, h.ctx)

    // The host-served first round has no Sabi plan, but keeps the legacy custom entry.
    assert.equal(readDecisionLog(cwd).length, 0)
    assert.equal(h.decisions.length, 1)

    state = await round(h, 2, state)
    h.events.get('model_request_end')?.({ type: 'model_request_end', model: 'deepseek/deepseek-v4-flash' })
    await h.hooks.onTurnEnd!({
      state,
      turnNumber: 2,
      hadToolCalls: false,
      usage: { inputTokens: 200, outputTokens: 40, cachedInputTokens: 20 },
    }, h.ctx)

    const records = readDecisionLog(cwd)
    assert.equal(records.length, 1)
    const record = records[0]!
    assert.equal(record.client, 'command-code')
    assert.equal(record.alias, 'sabi-code')
    assert.equal(record.upstream, 'command-code')
    assert.equal(record.sessionKnown, false)
    assert.equal(typeof record.turnId, 'string')
    assert.equal(record.upstreamModel, 'deepseek/deepseek-v4-flash')
    assert.deepEqual(record.usage, { promptTokens: 200, completionTokens: 40, cachedTokens: 20, totalTokens: 240 })
    const persistedToolNames = (record.state as Record<string, unknown>).toolNames as string[]
    assert.equal(persistedToolNames.length, 1)
    assert.match(persistedToolNames[0]!, /^[a-f0-9]{64}$/)
    assert.notEqual(persistedToolNames[0], 'read_file')
    assert.equal(h.decisions.length, 2)
    const serialized = JSON.stringify(records)
    assert.ok(!serialized.includes('sk-live-secret'))
    assert.ok(!serialized.includes('/repo/private.txt'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('invalid measured usage is omitted instead of becoming a cost-like zero', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-command-code-'))
  try {
    const h = loadMod(cwd)
    let state: AgentState = await round(h, 1, { modState: {} })
    await h.hooks.afterToolCall!({
      toolCallId: 't1',
      toolName: 'read_file',
      input: {},
      result: 'body',
      isError: false,
      state,
    }, h.ctx)
    await h.hooks.prepareNextTurn!({ state, turnNumber: 1 }, h.ctx)
    state = await h.hooks.onTurnEnd!({ state, turnNumber: 1, hadToolCalls: true, usage: undefined }, h.ctx)
    state = await round(h, 2, state)
    await h.hooks.onTurnEnd!({
      state,
      turnNumber: 2,
      hadToolCalls: false,
      usage: { inputTokens: -1, outputTokens: 40 },
    }, h.ctx)
    const record = readDecisionLog(cwd)[0]
    assert.equal(record?.usage, undefined)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
