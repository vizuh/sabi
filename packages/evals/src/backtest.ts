#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidateBeatsIncumbent, computeRecovery, decideTier, defaultLogPath, loadConfig, readDecisions, recoveryPairs, recoveryRate, recoveryStats } from '@sabi/core'

export interface SideEffectSafeReplayFixture<TInput, TOutput> {
  id: string
  input: TInput
  sideEffectSafe: true
  execute: (input: TInput) => TOutput
}

export interface FixtureReplayResult<TOutput> {
  id: string
  output: TOutput
  evidence: 'fixture'
}

export interface CalibratedSubset<T> {
  selected: T[]
  holdout: T[]
  calibrated: boolean
  seed: string
  reason?: 'insufficient-calibration'
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic fixture selector; no selection is silently called calibrated when data is absent. */
export function selectCalibratedSubset<T extends { id: string }>(
  items: readonly T[],
  options: { sampleSize?: number; holdoutFraction?: number; seed?: string } = {},
): CalibratedSubset<T> {
  const seed = options.seed ?? 'sabi-v1'
  const sampleSize = Math.max(1, Math.floor(options.sampleSize ?? 8))
  const holdoutFraction = Math.max(0.1, Math.min(0.5, options.holdoutFraction ?? 0.25))
  if (items.length < 2) return { selected: [], holdout: [], calibrated: false, seed, reason: 'insufficient-calibration' }

  const ordered = [...items].sort((left, right) => stableHash(`${seed}:${left.id}`) - stableHash(`${seed}:${right.id}`) || left.id.localeCompare(right.id))
  const holdoutCount = Math.max(1, Math.floor(ordered.length * holdoutFraction))
  const selectedCount = Math.min(sampleSize, ordered.length - holdoutCount)
  if (selectedCount < 1) return { selected: [], holdout: [], calibrated: false, seed, reason: 'insufficient-calibration' }
  return {
    selected: ordered.slice(0, selectedCount),
    holdout: ordered.slice(selectedCount),
    calibrated: true,
    seed,
  }
}

/** Explicit fixture seam. Nothing in the live route calls this function implicitly. */
export function replayFixture<TInput, TOutput>(fixture: SideEffectSafeReplayFixture<TInput, TOutput>): FixtureReplayResult<TOutput> {
  if (fixture.sideEffectSafe !== true) throw new Error('fixture replay requires an explicit side-effect-safe marker')
  return { id: fixture.id.slice(0, 128), output: fixture.execute(fixture.input), evidence: 'fixture' }
}

export function runBacktest(): void {
  const config = loadConfig()
  const logFile = defaultLogPath()
  const records = readDecisions(logFile)
  const profile = computeRecovery(records)

  const thresholds = config.judge?.thresholds ?? {}
  const vetoFloor = thresholds.veto ?? 0.25
  const realProblemFloor = thresholds.realProblem ?? 0.6

  console.log(`Backtest against ${logFile} (${records.length} rows)`)
  console.log('')
  console.log('Per-tier recovery rate (this machine\'s own history, n>=30 required to be usable):')

  for (const { tier, upstreamModel } of recoveryPairs(profile).sort((a, b) => `${a.tier}::${a.upstreamModel}`.localeCompare(`${b.tier}::${b.upstreamModel}`))) {
    const label = `${tier}::${upstreamModel}`
    const rate = recoveryRate(profile, tier, upstreamModel)
    if (rate) {
      console.log(`  ${label.padEnd(40)} n=${rate.eligible.toString().padStart(4)} recoveries=${rate.recoveries} pHat=${rate.pHat.toFixed(3)} wilsonLower=${rate.wilsonLower.toFixed(3)}`)
    } else {
      const n = recoveryStats(profile, tier, upstreamModel)
      const eligible = n ? n.recoveries + n.nonRecoveries : 0
      console.log(`  ${label.padEnd(40)} insufficient data (n=${eligible} < 30)`)
    }
  }
  if (recoveryPairs(profile).length === 0) console.log('  (no failure-rule rounds recorded yet)')

  console.log('')
  console.log('Counterfactual: ambiguous failure-rule rounds this rule would have changed:')

  let ambiguous = 0
  let wouldDecline = 0
  let actuallyKept = 0
  for (const record of records) {
    const realProblem = record.judge?.realProblem
    const originalTier = record.judge?.originalTier
    const finalTier = record.judge?.finalTier
    if (typeof realProblem !== 'number' || !originalTier || !finalTier) continue
    if (realProblem <= vetoFloor || realProblem >= realProblemFloor) continue
    ambiguous++
    if (finalTier === originalTier) actuallyKept++

    // Reuses the exact same decision inputs and predicate applyJudge() uses in production.
    const fallback = decideTier(record.state, config.policy, { exclude: ['failure'] })
    const incumbentModel = config.models[originalTier]?.model
    const candidateModel = config.models[fallback.tier]?.model
    const incumbent = incumbentModel ? recoveryRate(profile, originalTier, incumbentModel) : undefined
    const candidate = candidateModel ? recoveryRate(profile, fallback.tier, candidateModel) : undefined
    if (candidateBeatsIncumbent(candidate, incumbent)) wouldDecline++
  }

  console.log(`  ${ambiguous} ambiguous rounds found; ${actuallyKept} kept the escalation as-is (today's behavior).`)
  console.log(`  ${wouldDecline} of those would be declined by the local recovery-rate rule, given this machine's current history.`)
  console.log('  This is a measurement of stored decisions, not a re-execution — no live calls made.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runBacktest()
