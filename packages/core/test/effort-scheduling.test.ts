import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bandIndex,
  DIFFICULTY_MAX,
  difficultyPercent,
  effectiveMode,
  resolveEffortLadder,
  scheduleEffort,
} from '../src/effort.ts'
import { validateConfig } from '../src/config.ts'
import { serializeDecisionRecord } from '../src/log.ts'
import type { DecisionRecord, RouteDecision, SabiConfig, TrajectoryState } from '../src/types.ts'

/** The canonical block: eight keys, all present. See the `effortScheduling` docs in types.ts. */
const BLOCK = {
  enabled: true,
  mode: 'observe',
  scale: { min: 0, max: 100 },
  bands: 'uniform',
  ladders: { default: ['low', 'medium', 'high'] },
  curve: { default: 1.0 },
  floorLevel: { default: 'low' },
  judge: { weight: 0.5, minConfidence: 0.25, percent: { trivial: 20, standard: 50, demanding: 90 } },
} as const

const TIER = { upstream: 'u', model: 'm' }

const base = (models: Record<string, unknown> = { cheap: { ...TIER }, mid: { ...TIER } }) => ({
  upstreams: { u: { baseURL: 'http://127.0.0.1:1/v1' } },
  models,
  aliases: { a: 'cheap' },
  policy: { exploration: 'cheap' },
})

/** A config that went through validation. Source is `<t>` so message assertions match the plan. */
const config = (block: unknown, models?: Record<string, unknown>): SabiConfig =>
  validateConfig({ ...base(models), effortScheduling: block } as never, '<t>')

/** A config that did NOT go through validation — proves the defensive contract of effort.ts. */
const forged = (block: unknown): SabiConfig =>
  ({ ...base(), effortScheduling: block }) as unknown as SabiConfig

const decision = (
  tier: string,
  state: Record<string, unknown> = { roundKind: 'implementation' },
): Pick<RouteDecision, 'tier' | 'state'> =>
  ({ tier, state }) as unknown as Pick<RouteDecision, 'tier' | 'state'>

const state = (extra: Record<string, unknown>): TrajectoryState =>
  ({ roundKind: 'implementation', failure: 'none', ...extra }) as unknown as TrajectoryState

const record = (extra: Record<string, unknown>): DecisionRecord =>
  ({
    ts: 't', sessionId: 's', alias: 'a', mode: 'auto', rule: 'r', tier: 'cheap', reason: '',
    upstream: 'u', upstreamModel: 'm', stream: false, outcome: 'ok',
    state: { roundKind: 'exploration' }, ...extra,
  }) as unknown as DecisionRecord

const levels = (percents: number[], ladder: string[]): string[] =>
  percents.map((percent) => ladder[bandIndex(percent, ladder)])

const L3 = ['low', 'medium', 'high']
const L4 = ['low', 'medium', 'high', 'xhigh']
const L5 = ['low', 'medium', 'high', 'xhigh', 'max']

test('uniform bands: 3 levels split 0-100 into 0-33/34-66/67-100', () => {
  assert.deepEqual([0, 33, 34, 66, 67, 100].map((p) => bandIndex(p, L3)), [0, 0, 1, 1, 2, 2])
})

test('uniform bands: 4 levels split 0-100 into 25-wide bands', () => {
  assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 100].map((p) => bandIndex(p, L4)), [0, 0, 1, 1, 2, 2, 3, 3])
})

test('uniform bands: 5 levels reproduce the operator table (20-wide bands)', () => {
  assert.deepEqual(
    levels([0, 19, 20, 39, 40, 59, 60, 79, 80, 100], L5),
    ['low', 'low', 'medium', 'medium', 'high', 'high', 'xhigh', 'xhigh', 'max', 'max'],
  )
})

test('the band table is derived from the ladder, never fixed: same percent, different tier', () => {
  const wide = config({ ...BLOCK, ladders: { default: L5 } })
  const narrow = config(BLOCK)
  const exploration = decision('cheap', { roundKind: 'exploration' })
  // 13% is the first of three bands and the first of five: both land low.
  assert.equal(scheduleEffort(narrow, exploration)?.level, 'low')
  assert.equal(scheduleEffort(wide, exploration)?.level, 'low')
  // 47% is the second band of three (medium) and the third of five (high).
  const implementation = decision('cheap')
  assert.equal(scheduleEffort(narrow, implementation)?.level, 'medium')
  assert.equal(scheduleEffort(wide, implementation)?.level, 'high')
})

test('difficultyPercent: one percentage per round kind', () => {
  assert.equal(difficultyPercent(state({ roundKind: 'exploration' })).percent, 13)
  assert.equal(difficultyPercent(state({ roundKind: 'first-turn' })).percent, 27)
  assert.equal(difficultyPercent(state({ roundKind: 'unclassified' })).percent, 33)
  assert.equal(difficultyPercent(state({ roundKind: 'verification' })).percent, 40)
  assert.equal(difficultyPercent(state({ roundKind: 'implementation' })).percent, 47)
})

test('difficultyPercent: each extra term moves the percentage as documented', () => {
  assert.equal(difficultyPercent(state({ roundKind: 'exploration', failure: 'transport' })).percent, 20)
  assert.equal(difficultyPercent(state({ roundKind: 'implementation', failure: 'hard' })).percent, 67)
  assert.equal(
    difficultyPercent(state({ roundKind: 'implementation', failure: 'hard', repeatedFailure: true })).percent,
    80,
  )
  assert.equal(difficultyPercent(state({ roundKind: 'implementation', toolMessages: 8 })).percent, 53)
  assert.equal(difficultyPercent(state({ roundKind: 'first-turn', messageCount: 12 })).percent, 33)
  assert.equal(
    difficultyPercent(state({ roundKind: 'implementation', contextTokens: 95, contextWindow: 100 })).percent,
    60,
  )
})

test('difficultyPercent: the worst reachable round is 100% and DIFFICULTY_MAX is the max', () => {
  const worst = state({
    roundKind: 'implementation', failure: 'hard', repeatedFailure: true, toolMessages: 8,
    contextTokens: 95, contextWindow: 100,
  })
  assert.equal(difficultyPercent(worst).percent, 100)
  assert.equal(DIFFICULTY_MAX, 15)
})

test('difficultyPercent: pressure needs both a window and a measured total', () => {
  assert.equal(difficultyPercent(state({ contextTokens: 95 })).percent, 47)
  assert.equal(difficultyPercent(state({ contextWindow: 100 })).percent, 47)
})

test('the percentage never omits the field at either end of the scale', () => {
  const zeroed = config({ ...BLOCK, curve: { default: 0 } })
  const atZero = scheduleEffort(zeroed, decision('cheap'))
  assert.equal(atZero?.percent, 0)
  assert.equal(atZero?.level, 'low')
  const worst = decision('cheap', {
    roundKind: 'implementation', failure: 'hard', repeatedFailure: true, toolMessages: 8,
    contextTokens: 95, contextWindow: 100,
  })
  const atHundred = scheduleEffort(config(BLOCK), worst)
  assert.equal(atHundred?.percent, 100)
  assert.equal(atHundred?.level, 'high')
})

test('the floor raises a low band and stays silent when the band already clears it', () => {
  const floored = config({ ...BLOCK, curve: { default: 0 }, floorLevel: { default: 'medium' } })
  const raised = scheduleEffort(floored, decision('cheap'))
  assert.equal(raised?.percent, 0)
  assert.equal(raised?.index, 1)
  assert.equal(raised?.level, 'medium')
  assert.match(raised!.reason, /floor:medium/)
  // A round whose band already sits on the floor is untouched, and no floor token is emitted.
  const above = config({ ...BLOCK, floorLevel: { default: 'medium' } })
  const already = scheduleEffort(above, decision('cheap'))
  assert.equal(already?.percent, 47)
  assert.equal(already?.index, 1)
  assert.equal(already?.level, 'medium')
  assert.doesNotMatch(already!.reason, /floor:/)
})

test('the curve scales the planned percentage and marks the clamp', () => {
  const doubled = config({ ...BLOCK, curve: { default: 2.0 } })
  const high = scheduleEffort(doubled, decision('cheap'))
  assert.equal(high?.planned, 47)
  assert.equal(high?.percent, 94)
  assert.doesNotMatch(high!.reason, /clamped/)
  const worst = decision('cheap', {
    roundKind: 'implementation', failure: 'hard', repeatedFailure: true, toolMessages: 8,
    contextTokens: 95, contextWindow: 100,
  })
  const clamped = scheduleEffort(doubled, worst)
  assert.equal(clamped?.planned, 100)
  assert.equal(clamped?.percent, 100)
  assert.match(clamped!.reason, /clamped/)
})

test('the judge refines the percentage only when it cleared the confidence floor', () => {
  const demanding = { difficulty: 'demanding', difficultyConfidence: 0.9 }
  const half = scheduleEffort(config(BLOCK), decision('cheap'), demanding)
  assert.equal(half?.planned, 69)
  assert.match(half!.reason, /judge:demanding/)
  const quarter = config({ ...BLOCK, judge: { ...BLOCK.judge, weight: 0.25 } })
  assert.equal(scheduleEffort(quarter, decision('cheap'), demanding)?.planned, 58)
  const unsure = scheduleEffort(config(BLOCK), decision('cheap'), { ...demanding, difficultyConfidence: 0.1 })
  assert.equal(unsure?.planned, 47)
  assert.doesNotMatch(unsure!.reason, /judge:/)
  const unknown = scheduleEffort(config(BLOCK), decision('cheap'), { difficulty: 'weird', difficultyConfidence: 0.9 })
  assert.equal(unknown?.planned, 47)
})

test('the feature is inert without an actionable block', () => {
  const bare = validateConfig(base()) as SabiConfig
  assert.equal(effectiveMode(bare), 'off')
  assert.equal(scheduleEffort(bare, decision('cheap')), undefined)
  assert.equal(effectiveMode(config({ ...BLOCK, enabled: false })), 'off')
  assert.equal(scheduleEffort(config({ ...BLOCK, enabled: false }), decision('cheap')), undefined)
  assert.equal(effectiveMode(config({ ...BLOCK, mode: 'off' })), 'off')
  assert.equal(scheduleEffort(config({ ...BLOCK, mode: 'off' }), decision('cheap')), undefined)
  assert.equal(effectiveMode(config(BLOCK)), 'observe')
  // Rejected by validation; a forged config still reports its mode rather than guessing.
  assert.equal(effectiveMode(forged({ ...BLOCK, mode: 'fill' })), 'fill')
  assert.equal(effectiveMode(forged({ ...BLOCK, mode: 'override' })), 'override')
})

test('a malformed or unvalidated config yields undefined, never an exception', () => {
  // The V9 case is rejected by validateConfig; effort.ts must still be total on forged input.
  assert.equal(scheduleEffort(forged({ ...BLOCK, ladders: { cheap: L3 } }), decision('mid')), undefined)
  assert.equal(scheduleEffort(forged({ ...BLOCK, ladders: { default: [] } }), decision('cheap')), undefined)
  assert.equal(scheduleEffort(forged({ ...BLOCK, ladders: {} }), decision('cheap')), undefined)
  assert.equal(scheduleEffort(forged({ ...BLOCK, ladders: 'x' }), decision('cheap')), undefined)
  assert.equal(scheduleEffort(forged({ ...BLOCK, curve: 'x', floorLevel: 'x', judge: 'x' }), decision('cheap'))?.level, 'medium')
  assert.equal(effectiveMode(forged(undefined)), 'off')
  assert.equal(resolveEffortLadder(forged({ ...BLOCK, ladders: {} }), 'cheap'), undefined)
  assert.equal(bandIndex(50, []), 0)
  assert.equal(bandIndex(Number.NaN, L3), 0)
  assert.equal(difficultyPercent(undefined as unknown as TrajectoryState).percent, 33)
})

test('the reason is always the fixed token vocabulary', () => {
  const REASON = /^kind:(first-turn|exploration|implementation|verification|unclassified)(\+(ctx-high|ctx-pressure|transport|hard-failure|stuck|tool-churn|large-first-turn|clamped|judge:(trivial|standard|demanding)|curve:[A-Za-z0-9._-]+|floor:[A-Za-z0-9._-]+))*$/
  const cases: Array<[Record<string, unknown>, { difficulty?: string; difficultyConfidence?: number } | undefined]> = [
    [{ roundKind: 'exploration' }, undefined],
    [{ roundKind: 'implementation', failure: 'hard', repeatedFailure: true }, undefined],
    [{ roundKind: 'verification', contextTokens: 95, contextWindow: 100 }, { difficulty: 'demanding', difficultyConfidence: 0.9 }],
  ]
  for (const [input, judge] of cases) {
    const scheduled = scheduleEffort(config({ ...BLOCK, curve: { default: 2 } }), decision('cheap', input), judge)
    assert.ok(scheduled)
    assert.match(scheduled.reason, REASON)
  }
})

test('sanitizeDecisionRecord round-trips the six fields and bounds each one', () => {
  const parsed = JSON.parse(serializeDecisionRecord(record({
    effortPercent: 47, effortPlanned: 47, effortIndex: 1, effortLevel: 'medium',
    effortLadder: L3, effortReason: 'kind:implementation', effort: 'medium', effortSource: 'client',
  })))
  assert.deepEqual(
    [parsed.effortPercent, parsed.effortPlanned, parsed.effortIndex, parsed.effortLevel,
      parsed.effortLadder, parsed.effortReason, parsed.effort, parsed.effortSource],
    [47, 47, 1, 'medium', L3, 'kind:implementation', 'medium', 'client'],
  )
  const bounded = JSON.parse(serializeDecisionRecord(record({
    effortLadder: Array.from({ length: 12 }, (_, index) => `L${index}`),
    effortLevel: 'x'.repeat(100), effortReason: 'k'.repeat(300),
  })))
  assert.equal(bounded.effortLadder.length, 8)
  assert.equal(bounded.effortLevel.length, 32)
  assert.equal(bounded.effortReason.length, 120)
  const dropped = JSON.parse(serializeDecisionRecord(record({
    effortLevel: '<bad>', effortPercent: 150, effortIndex: 9, effortLadder: ['<bad>', 'low'],
  })))
  assert.equal(dropped.effortLevel, undefined)
  assert.equal(dropped.effortPercent, undefined)
  assert.equal(dropped.effortIndex, undefined)
  assert.equal(dropped.effortLadder, undefined)
})

test('a complete block passes validation and a bare config stays valid', () => {
  assert.equal(config(BLOCK).effortScheduling?.mode, 'observe')
  assert.equal((validateConfig(base()) as SabiConfig).effortScheduling, undefined)
})

test('omitting any one of the eight keys is rejected', () => {
  for (const key of Object.keys(BLOCK)) {
    const partial: Record<string, unknown> = { ...BLOCK }
    delete partial[key]
    assert.throws(() => config(partial), /effortScheduling/)
  }
})

test('effortScheduling must be an object and an unknown member is rejected', () => {
  assert.throws(() => config('x'), /effortScheduling must be an object/)
  assert.throws(() => config({ ...BLOCK, extra: 1 }), /effortScheduling has an unknown field/)
})

test('one rejection per validation rule', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ enabled: 'yes' }, /effortScheduling\.enabled must be a boolean/],
    [{ mode: 'nope' }, /effortScheduling\.mode must be off or observe/],
    [{ mode: 'override' }, /reserved until injection ships/],
    [{ ladders: { default: ['low', 'high'], strnog: ['low', 'high'] } }, /ladders\.strnog must reference 'default' or a declared tier/],
    [{ floorLevel: { default: 5 } }, /floorLevel\.default must be a level name/],
    [{ floorLevel: { default: null } }, /floorLevel\.default must be a level name/],
    [{ judge: { ...BLOCK.judge, enabled: false } }, /effortScheduling\.judge has an unknown field/],
    [{ scale: { min: 0, max: 10 } }, /effortScheduling\.scale must be \{min: 0, max: 100\}/],
    [{ scale: { min: 0, max: 100, extra: 1 } }, /effortScheduling\.scale must be \{min: 0, max: 100\}/],
    [{ bands: 'fixed' }, /effortScheduling\.bands must be "uniform"/],
    [{ ladders: 'x' }, /effortScheduling\.ladders must be an object/],
    [{ ladders: { default: ['low'] } }, /effortScheduling\.ladders\.default must be an array of 2 to 8 distinct level names/],
    [{ ladders: { default: ['low', 'low'] } }, /effortScheduling\.ladders\.default must be an array of 2 to 8 distinct level names/],
    [{ ladders: { default: ['low', 'ba d'] } }, /effortScheduling\.ladders\.default must be an array of 2 to 8 distinct level names/],
    [{ curve: 'x' }, /effortScheduling\.curve must be an object/],
    [{ curve: { nope: 1 } }, /effortScheduling\.curve\.nope must reference 'default' or a declared tier/],
    [{ curve: { default: 5 } }, /effortScheduling\.curve\.default must be a number between 0 and 2/],
    [{ floorLevel: 'x' }, /effortScheduling\.floorLevel must be an object/],
    [{ floorLevel: { nope: 'low' } }, /effortScheduling\.floorLevel\.nope must reference 'default' or a declared tier/],
    [{ judge: 'x' }, /effortScheduling\.judge must be an object/],
    [{ judge: { weight: 2 } }, /effortScheduling\.judge\.weight must be a number between 0 and 1/],
    [{ judge: { weight: 0.5, minConfidence: 2 } }, /effortScheduling\.judge\.minConfidence must be a number between 0 and 1/],
    [{ judge: { weight: 0.5, minConfidence: 0.25 } }, /effortScheduling\.judge\.percent must be an object/],
    [{ judge: { weight: 0.5, minConfidence: 0.25, percent: { nope: 1 } } }, /effortScheduling\.judge\.percent has an unknown field/],
    [{ judge: { weight: 0.5, minConfidence: 0.25, percent: {} } }, /effortScheduling\.judge\.percent\.trivial must be an integer between 0 and 100/],
    [{ judge: { weight: 0.5, minConfidence: 0.25, percent: { trivial: 20, standard: 50, demanding: 101 } } }, /effortScheduling\.judge\.percent\.demanding must be an integer between 0 and 100/],
  ]
  for (const [override, expected] of cases) {
    assert.throws(() => config({ ...BLOCK, ...override }), expected)
  }
})

test('V9 rejects a tier with no resolvable ladder of its own or by default', () => {
  assert.throws(
    () => config({ ...BLOCK, ladders: { cheap: L3 } }),
    /ladders must resolve a ladder for tier 'mid' \(add ladders\.mid or ladders\.default\)/,
  )
})

test('V15 compares the effective floor against the effective ladder, per tier', () => {
  assert.throws(
    () => config({ ...BLOCK, ladders: { default: L3, mid: ['minimal', 'low', 'high'] }, floorLevel: { default: 'medium' } }),
    /floorLevel\.default must be a level of the ladder for tier 'mid'/,
  )
  assert.throws(
    () => config({ ...BLOCK, ladders: { cheap: L3, mid: ['minimal', 'low', 'high'] }, floorLevel: { mid: 'medium' } }),
    /floorLevel\.mid must be a level of the ladder for tier 'mid'/,
  )
  assert.throws(
    () => config({ ...BLOCK, ladders: { cheap: L3, mid: L3 }, floorLevel: { default: 'xhigh' } }),
    /floorLevel\.default must be a level of the ladder for tier 'cheap'/,
  )
  assert.doesNotThrow(
    () => config({ ...BLOCK, ladders: { default: L3, mid: ['minimal', 'low', 'medium'] }, floorLevel: { default: 'medium' } }),
  )
})

test('V15 positive: the floor applies on the tier own ladder, and the contrast proves it', () => {
  const ladder = { default: L3, mid: ['minimal', 'low', 'medium'] }
  const floored = config({ ...BLOCK, ladders: ladder, floorLevel: { default: 'medium' } })
  const withFloor = scheduleEffort(floored, decision('mid', { roundKind: 'exploration' }))
  assert.equal(withFloor?.percent, 13)
  assert.equal(withFloor?.index, 2)
  assert.equal(withFloor?.level, 'medium')
  // Same ladder, no floor: the band index stands on its own.
  const bare = config({ ...BLOCK, ladders: ladder, floorLevel: {} })
  const without = scheduleEffort(bare, decision('mid', { roundKind: 'exploration' }))
  assert.equal(without?.percent, 13)
  assert.equal(without?.index, 0)
  assert.equal(without?.level, 'minimal')
  // Default fixture round kind (implementation, D1 = 47) climbs one band then the floor lifts one more.
  assert.equal(scheduleEffort(floored, decision('mid'))?.index, 2)
  assert.equal(scheduleEffort(floored, decision('mid'))?.level, 'medium')
})

test('validation accepts ladders resolved purely per tier', () => {
  const perTier = config({ ...BLOCK, ladders: { cheap: L3, mid: L4 }, floorLevel: {} })
  assert.equal(resolveEffortLadder(perTier, 'cheap')?.length, 3)
  assert.equal(resolveEffortLadder(perTier, 'mid')?.length, 4)
  // Same percentage, two ladders, same band index — the level name differs because the ladder does:
  // 47% is band 1 of three ('medium') and band 1 of four ('medium'), while 75% would be band 3.
  assert.equal(scheduleEffort(perTier, decision('mid'))?.level, L4[1])
  assert.equal(scheduleEffort(perTier, decision('cheap'))?.level, L3[1])
  assert.equal(scheduleEffort(perTier, decision('mid'))?.index, 1)
  assert.equal(bandIndex(75, L4), 3)
  assert.equal(bandIndex(75, L3), 2)
})

test('a ladder level the tier does not declare in reasoningEfforts is rejected', () => {
  assert.throws(() => config({ ...BLOCK, ladders: { default: ['low', 'medium', 'high'] } },
    { cheap: { ...TIER, capabilities: { reasoningEfforts: ['low', 'medium'] } }, mid: { ...TIER } }),
  /tier 'cheap' has level 'high'/)
})

test('context pressure is measured against the scheduled tier own window', () => {
  const models = { cheap: { ...TIER, contextWindow: 32_000 }, big: { ...TIER, contextWindow: 1_000_000 } }
  const cfg = config(BLOCK, models)
  // The router's contextWindow is the smallest across tiers (32k); 30k is 94% of that, 3% of big.
  const pressed = { roundKind: 'exploration', contextWindow: 32_000, contextTokens: 30_000 }
  assert.doesNotMatch(scheduleEffort(cfg, decision('big', pressed))!.reason, /ctx-/)
  assert.match(scheduleEffort(cfg, decision('cheap', pressed))!.reason, /ctx-high/)
})

test('a tier named like a prototype key resolves the default floor', () => {
  const cfg = config({ ...BLOCK, floorLevel: { default: 'high' } }, { constructor: { ...TIER }, cheap: { ...TIER } })
  assert.equal(scheduleEffort(cfg, decision('constructor', { roundKind: 'exploration' }))!.level, 'high')
})
