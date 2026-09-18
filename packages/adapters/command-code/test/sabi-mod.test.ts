import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentState, ModApi, ModContext, ModHooks } from '@commandcode/harness'
import sabi from '../mod/sabi.ts'

interface Harness {
  hooks: ModHooks
  events: Map<string, (event: unknown) => void>
  notices: string[]
  decisions: Array<Record<string, unknown>>
  ctx: ModContext
}

function loadMod(): Harness {
  const harness: Partial<Harness> = { notices: [], decisions: [], events: new Map() }
  harness.ctx = {
    cwd: process.cwd(),
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
