#!/usr/bin/env node
import { candidateBeatsIncumbent, computeRecovery, decideTier, defaultLogPath, loadConfig, readDecisions, recoveryPairs, recoveryRate, recoveryStats } from '@sabi/core'

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
  if (realProblem <= vetoFloor || realProblem >= realProblemFloor) continue // not the ambiguous band
  ambiguous++
  if (finalTier === originalTier) actuallyKept++

  // Reuses the exact same decision inputs and predicate applyJudge() uses in production
  // (packages/core/src/judge.ts) — this is a measurement of the real rule, not a re-derivation
  // that could silently drift from it.
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
