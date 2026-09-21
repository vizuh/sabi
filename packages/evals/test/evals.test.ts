import test from 'node:test'
import assert from 'node:assert/strict'
import { runEval, type EvalConfigInput } from '../src/harness.ts'
import { TASK_SET, normalizeEvalEpisode, type EvalTask } from '../src/tasks.ts'
import { replayFixture, selectCalibratedSubset } from '../src/backtest.ts'
import type { RecoveryObservation } from '@sabi/core'

const config: EvalConfigInput = {
  policy: {
    failure: 'strong',
    stuck: 'mid',
    'context-pressure': 'mid',
    transport: 'mid',
    'first-turn': 'mid',
    verification: 'mid',
    implementation: 'mid',
    exploration: 'cheap',
    unclassified: 'cheap',
  },
  models: {
    cheap: { cost: { input: 0.2, output: 0.6 } },
    mid: { cost: { input: 1, output: 2 } },
    strong: { cost: { input: 8, output: 24 } },
  },
  baselineTier: 'mid',
  contextWindow: 1_000_000,
}

test('the frozen task set replays through deterministic routing without paid calls', () => {
  const summary = runEval(config, TASK_SET)
  assert.equal(summary.totals.tasks, TASK_SET.length)
  assert.ok(summary.totals.rounds > 0)
  // Every replay round has a rule and a tier.
  for (const task of summary.tasks) {
    for (const round of task.rounds) {
      assert.ok(round.rule.length > 0)
      assert.ok(round.tier.length > 0)
    }
  }
  // No network: the run is pure.
  assert.ok(summary.sabi.cost !== null && summary.sabi.cost >= 0)
})

test('the verify-failing-test task escalates to strong', () => {
  const summary = runEval(config, TASK_SET)
  const task = summary.tasks.find((t) => t.taskId === 'verify-failing-test')
  assert.ok(task)
  assert.ok(task.rounds.some((round) => round.tier === 'strong'))
})

test('the stuck task routes to the stuck tier on the repeated round', () => {
  const summary = runEval(config, TASK_SET)
  const task = summary.tasks.find((t) => t.taskId === 'stuck-repeated-failure')
  assert.ok(task)
  const last = task.rounds[task.rounds.length - 1]
  assert.equal(last.rule, 'stuck')
  assert.equal(last.repeatedFailure, true)
  assert.equal(last.failureStreak, 2)
})

test('the expected-failure task escalates without Jev (honest deterministic behavior)', () => {
  const summary = runEval(config, TASK_SET)
  const task = summary.tasks.find((t) => t.taskId === 'expected-failure-user')
  assert.ok(task)
  // The offline replay does not include the Jev layer, so the deterministic default is
  // strong for any hard failure — including the expected-failure task. This is the honest
  // pre-judge behavior; the live proxy applies Jev to veto it. The harness documents it.
  assert.ok(task.rounds.some((round) => round.rule === 'failure'))
  assert.ok(summary.quality.failedEscalated >= 1)
})

test('routing to cheaper tiers than the baseline produces positive savings', () => {
  // A task set with only cheap rounds (explore + edit) should beat the all-mid baseline.
  const cheapTasks = TASK_SET.filter((task) => task.id === 'explore-small-grep' || task.id === 'edit-implementation')
  const summary = runEval(config, cheapTasks)
  assert.ok(summary.sabi.savingsPct !== null && summary.sabi.savingsPct > 0)
  assert.ok(summary.sabi.cost !== null && summary.baseline.cost !== null && summary.sabi.cost < summary.baseline.cost)
})

test('context-pressure fires when the window is small enough', () => {
  // A single round whose transcript is large relative to a small declared window.
  const bigContextTask: EvalTask = {
    id: 'big-context-read',
    name: 'huge file read',
    instruction: 'Read the huge generated file and fix the bug.',
    messages: [
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'Read the huge generated file and fix the bug.' },
      { role: 'assistant', tool_calls: [{ function: { name: 'read_file', arguments: '{"absolute_path":"/repo/huge.ts"}' } }] },
      { role: 'tool', content: 'x'.repeat(20_000) },
    ],
    outcome: 'pass',
    note: 'large tool result pushes the estimated context over a small window',
  }
  const smallWindow = runEval({ ...config, contextWindow: 2000 }, [bigContextTask])
  assert.equal(smallWindow.routing.byRule['context-pressure'], 1)
})

test('a rate-limited round routes to the transport tier, never escalating to strong', () => {
  const summary = runEval(config, TASK_SET)
  const task = summary.tasks.find((t) => t.taskId === 'rate-limited-upstream')
  assert.ok(task, 'rate-limit task present')
  assert.equal(task.rounds[0]?.tier, 'mid')
  assert.equal(task.rounds[0]?.rule, 'transport')
  assert.ok(task.rounds[0]?.reason.includes('transport'))
})

test('a fixed baseline comparison is deterministic', () => {
  const a = runEval(config, TASK_SET)
  const b = runEval(config, TASK_SET)
  assert.deepEqual(a, b)
})
test('unknown pricing stays unknown instead of appearing free', () => {
  const summary = runEval({ ...config, models: { cheap: {}, mid: {}, strong: {} } }, TASK_SET)
  assert.equal(summary.sabi.cost, null)
  assert.equal(summary.baseline.cost, null)
  assert.equal(summary.sabi.savingsPct, null)
})

test('a compaction boundary restarts the failure streak instead of reporting stuck', () => {
  const summary = runEval(config, TASK_SET)
  const task = summary.tasks.find((t) => t.taskId === 'compaction-reset')
  assert.ok(task)
  const last = task.rounds[task.rounds.length - 1]
  assert.equal(last?.rule, 'failure')
  assert.notEqual(last?.repeatedFailure, true)
  assert.equal(last?.failureStreak, 1)
  assert.equal(last?.contextGeneration, 1)
})

test('normalized episodes keep coverage, verification, causal grade, and failure phase labels separate', () => {
  const recovery: RecoveryObservation = {
    failureSignature: 'failure-1',
    stateFingerprint: 'state-1',
    action: 'retry-with-feedback',
    outcome: 'recovered',
    evidenceGrade: 'matched',
    contextGeneration: 0,
  }
  const episodes = (['pre', 'live', 'post'] as const).map((phase) => normalizeEvalEpisode({
    id: `phase-${phase}`,
    name: 'fixture',
    instruction: 'fixture',
    messages: [],
    outcome: 'pass',
    note: 'fixture only',
    phase,
    verification: { status: 'unknown', reason: 'invalid-receipt' },
    coverage: { expected: 20, observed: 13, ratio: 0.65, source: 'explicit' },
    recovery,
  }))
  assert.deepEqual(episodes.map((episode) => episode.phase), ['pre', 'live', 'post'])
  assert.deepEqual(episodes.map((episode) => episode.coverage?.ratio), [0.65, 0.65, 0.65])
  assert.deepEqual(episodes.map((episode) => episode.verification?.status), ['unknown', 'unknown', 'unknown'])
  assert.deepEqual(episodes.map((episode) => episode.recovery?.evidenceGrade), ['matched', 'matched', 'matched'])
})

test('fixture replay requires an explicit side-effect-safe seam and returns fixture evidence', () => {
  const replay = replayFixture({ id: 'safe-fixture', input: { value: 2 }, sideEffectSafe: true, execute: ({ value }) => value * 2 })
  assert.deepEqual(replay, { id: 'safe-fixture', output: 4, evidence: 'fixture' })
})

test('calibrated fixture selection is deterministic and keeps a holdout', () => {
  const items = TASK_SET.slice(0, 6)
  const first = selectCalibratedSubset(items, { sampleSize: 3, seed: 'fixed-seed' })
  const second = selectCalibratedSubset(items, { sampleSize: 3, seed: 'fixed-seed' })
  assert.equal(first.calibrated, true)
  assert.deepEqual(first.selected.map((item) => item.id), second.selected.map((item) => item.id))
  assert.deepEqual(first.holdout.map((item) => item.id), second.holdout.map((item) => item.id))
  assert.equal(new Set([...first.selected, ...first.holdout]).size, 6)
})

test('missing calibration is explicit rather than an empty success', () => {
  const result = selectCalibratedSubset([{ id: 'only-task' }], { sampleSize: 3 })
  assert.deepEqual(result, { selected: [], holdout: [], calibrated: false, seed: 'sabi-v1', reason: 'insufficient-calibration' })
})
