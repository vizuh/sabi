import type { EffortMode, RouteDecision, SabiConfig, TrajectoryState } from './types.ts'

export type { EffortMode }

/**
 * Highest raw difficulty sum reachable from the terms below: 7 (implementation) + 2 (context
 * pressure) + 3 (hard failure) + 2 (repeated failure) + 1 (tool churn). Exported so the tests and
 * the 0-100 normalisation cannot drift apart: 100% is reachable, not a ceiling of convenience.
 */
export const DIFFICULTY_MAX = 15

export interface EffortSchedule {
  percent: number
  planned: number
  index: number
  level: string
  ladder: string[]
  reason: string
}

/** Per-round-kind base of the difficulty percentage. Keys are `RoundKind` values. */
const BASE_BY_KIND: Record<string, number> = {
  exploration: 2,
  'first-turn': 4,
  unclassified: 5,
  verification: 6,
  implementation: 7,
}

const JUDGE_DIFFICULTIES: ReadonlySet<string> = new Set(['trivial', 'standard', 'demanding'])
const REASON_MAX_CHARS = 120

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function roundedInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value)
  if (!Number.isFinite(rounded)) return min
  return Math.min(max, Math.max(min, rounded))
}

/**
 * A per-tier table entry: the tier's own key, else `default`. Own keys only, so a tier named like an
 * inherited property (`constructor`) cannot pick up a prototype value. Validation and the runtime
 * both resolve ladders and floors through this, so what loads is what runs.
 */
export function effortTableEntry(table: Record<string, unknown>, tier: string): unknown {
  return Object.hasOwn(table, tier) ? table[tier] : table.default
}

/** The configured block, or `undefined` when it is absent or not an object. Never throws. */
function effortBlock(config: SabiConfig): Record<string, unknown> | undefined {
  const block = (config as unknown as { effortScheduling?: unknown } | undefined)?.effortScheduling
  return isObject(block) ? block : undefined
}

/**
 * `'off'` means inert: no block, `enabled` not exactly `true`, or a mode that cannot be acted on.
 * An unknown mode string is treated as `off` rather than guessed at.
 */
export function effectiveMode(config: SabiConfig): EffortMode {
  const block = effortBlock(config)
  if (!block || block.enabled !== true) return 'off'
  const mode = block.mode
  if (mode === 'observe' || mode === 'fill' || mode === 'override') return mode
  return 'off'
}

/**
 * The ladder this tier resolves to: its own entry, else `default`. `undefined` for an absent,
 * empty or malformed ladder — the caller treats that as "no scheduling for this round", never as
 * an error.
 */
export function resolveEffortLadder(config: SabiConfig, tier: string): string[] | undefined {
  const block = effortBlock(config)
  if (!block) return undefined
  const ladders = block.ladders
  if (!isObject(ladders)) return undefined
  const raw = effortTableEntry(ladders, tier)
  if (!Array.isArray(raw)) return undefined
  const ladder = raw.filter((level): level is string => typeof level === 'string' && level.length > 0)
  return ladder.length > 0 ? ladder : undefined
}

/**
 * Difficulty of this round as a percentage of `DIFFICULTY_MAX`, with a fixed-vocabulary reason
 * token list. Pure and total: a partial or forged state yields the `unclassified` base instead of
 * throwing, so a malformed round degrades to a sane percentage rather than failing the request.
 */
export function difficultyPercent(state: TrajectoryState, tierContextWindow?: number): { percent: number; reason: string } {
  const s = (state ?? {}) as Partial<TrajectoryState>
  const rawKind = typeof s.roundKind === 'string' ? s.roundKind : ''
  const kind = Object.hasOwn(BASE_BY_KIND, rawKind) ? rawKind : 'unclassified'
  const tokens: string[] = [`kind:${kind}`]
  let raw = BASE_BY_KIND[kind] ?? 0

  // The router's `contextWindow` is the smallest window across the policy's tiers; pressure is
  // measured against the window of the tier being scheduled when it declares one.
  const window = num(tierContextWindow) ?? num(s.contextWindow)
  const used = num(s.contextTokens)
  if (window !== undefined && window > 0 && used !== undefined) {
    const ratio = used / window
    if (ratio >= 0.9) {
      raw += 2
      tokens.push('ctx-high')
    } else if (ratio >= 0.75) {
      raw += 1
      tokens.push('ctx-pressure')
    }
  }

  if (s.failure === 'transport') {
    raw += 1
    tokens.push('transport')
  }
  if (s.failure === 'hard') {
    raw += 3
    tokens.push('hard-failure')
  }
  if (s.repeatedFailure === true) {
    raw += 2
    tokens.push('stuck')
  }
  const toolMessages = num(s.toolMessages)
  if (toolMessages !== undefined && toolMessages >= 8) {
    raw += 1
    tokens.push('tool-churn')
  }
  const messageCount = num(s.messageCount)
  if (kind === 'first-turn' && messageCount !== undefined && messageCount >= 12) {
    raw += 1
    tokens.push('large-first-turn')
  }

  const bounded = Math.min(DIFFICULTY_MAX, Math.max(0, raw))
  const percent = roundedInt((bounded / DIFFICULTY_MAX) * 100, 0, 100)
  return { percent, reason: tokens.join('+').slice(0, REASON_MAX_CHARS) }
}

/**
 * Uniform bands derived from the ladder: `n` levels split 0-100 into `n` equal bands, so the same
 * table adapts to a model with fewer or more reasoning steps without a fixed threshold anywhere.
 * `0-19 low, 20-39 medium, 40-59 high, 60-79 xhigh, 80-100 max` for `n = 5`; `0-33/34-66/67-100`
 * for `n = 3`. 100% always lands on the last level and 0% on the first. Total: an empty ladder or a
 * non-finite percentage yields 0 instead of throwing.
 */
export function bandIndex(percent: number, ladder: string[]): number {
  const size = Array.isArray(ladder) ? ladder.length : 0
  if (size === 0) return 0
  if (!Number.isFinite(percent)) return 0
  const scaled = Math.floor((percent * size) / 100)
  return Math.min(size - 1, Math.max(0, scaled))
}

/**
 * The schedule for this round, or `undefined` when there is nothing to schedule: the block is
 * inert, or this tier resolves no ladder. The percentage comes from the round's own state, is
 * refined by the judge when it ran and passed the confidence floor, scaled by the per-tier curve,
 * clamped to 0-100, and finally resolved to a concrete level by the tier's uniform bands.
 *
 * Pure: no I/O, no clock, no randomness, and no path throws — a malformed config or state yields
 * `undefined`, which callers read as "this round has no schedule", never as a failed round.
 */
export function scheduleEffort(
  config: SabiConfig,
  decision: Pick<RouteDecision, 'tier' | 'state'>,
  judge?: { difficulty?: string; difficultyConfidence?: number },
): EffortSchedule | undefined {
  if (effectiveMode(config) === 'off') return undefined
  const block = effortBlock(config)
  if (!block) return undefined
  const tier = typeof decision?.tier === 'string' ? decision.tier : ''
  const ladder = resolveEffortLadder(config, tier)
  if (!ladder) return undefined

  const models = (config as { models?: Record<string, { contextWindow?: number } | undefined> }).models
  const base = difficultyPercent(decision?.state as TrajectoryState,
    isObject(models) && Object.hasOwn(models, tier) ? models[tier]?.contextWindow : undefined)
  const tokens = base.reason.split('+')
  let planned = base.percent

  // The judge only refines: it is consulted when it actually ran, named a known difficulty and
  // cleared the confidence floor. It can move the percentage either way, so it is applied before
  // the curve and the floor, which are the tier's own bounds.
  const judgeCfg = isObject(block.judge) ? block.judge : undefined
  if (judgeCfg) {
    const difficulty = typeof judge?.difficulty === 'string' ? judge.difficulty : undefined
    const confidence = num(judge?.difficultyConfidence)
    const minConfidence = num(judgeCfg.minConfidence) ?? 0
    const weight = num(judgeCfg.weight) ?? 0
    const table = isObject(judgeCfg.percent) ? judgeCfg.percent : undefined
    const judgePercent = difficulty !== undefined && table ? num(table[difficulty]) : undefined
    if (difficulty !== undefined && JUDGE_DIFFICULTIES.has(difficulty) && confidence !== undefined
      && weight > 0 && judgePercent !== undefined && confidence >= minConfidence) {
      planned = roundedInt((1 - weight) * base.percent + weight * judgePercent, 0, 100)
      tokens.push(`judge:${difficulty}`)
    }
  }

  const curveTable = isObject(block.curve) ? block.curve : undefined
  const ownCurve = curveTable && Object.hasOwn(curveTable, tier) ? num(curveTable[tier]) : undefined
  const curve = ownCurve ?? (curveTable ? num(curveTable.default) : undefined) ?? 1
  const scaled = planned * (Number.isFinite(curve) ? curve : 1)
  const percent = roundedInt(scaled, 0, 100)
  if (curve !== 1) tokens.push(`curve:${ownCurve !== undefined ? tier : 'default'}`)

  const floorTable = isObject(block.floorLevel) ? block.floorLevel : undefined
  const floorRaw = floorTable ? effortTableEntry(floorTable, tier) : undefined
  let index = bandIndex(percent, ladder)
  if (typeof floorRaw === 'string' && floorRaw.length > 0) {
    const floorIndex = ladder.indexOf(floorRaw)
    // A floor below the band changes nothing; an unknown level is ignored here (validation rejects
    // it, and this function must stay total for unvalidated input).
    if (floorIndex > index) {
      index = floorIndex
      tokens.push(`floor:${floorRaw}`)
    }
  }
  if (scaled > 100 && percent === 100) tokens.push('clamped')

  const level = ladder[index]
  if (typeof level !== 'string' || level.length === 0) return undefined
  return { percent, planned, index, level, ladder, reason: tokens.join('+').slice(0, REASON_MAX_CHARS) }
}
