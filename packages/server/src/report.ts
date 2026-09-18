#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { defaultLogPath, estimateCost, loadConfig, type DecisionRecord } from '@sabi/core'

const config = loadConfig()
const logFile = defaultLogPath()
const asJson = process.argv.includes('--json')

if (!existsSync(logFile)) {
  console.error(`No decision log at ${logFile} — start Sabi and send a request first.`)
  process.exit(1)
}

const rows: DecisionRecord[] = []
for (const line of readFileSync(logFile, 'utf8').split('\n')) {
  if (!line.trim()) continue
  try {
    rows.push(JSON.parse(line) as DecisionRecord)
  } catch {
    // skip malformed line
  }
}

const strong = config.models.strong ?? Object.values(config.models)[0]
const sessions = new Set(rows.filter(row => row.sessionKnown === true).map(row => row.sessionId))
const unattributedRequests = rows.filter(row => row.sessionKnown !== true).length
const byTier = new Map<string, number>()
const byRule = new Map<string, number>()
const byModel = new Map<string, number>()
let promptTokens = 0
let completionTokens = 0
let cachedTokens = 0
let cost = 0
let counterfactual = 0
let errors = 0
let transports = 0
let judgeCalls = 0
let judgeErrors = 0
let judgeCached = 0
let judgeOverridesDown = 0
let judgeOverridesUp = 0
let judgeLatencyMs = 0
let judgeLatencyCount = 0
let judgeInputTokens = 0
let unknownCostRows = 0
let unknownCounterfactualRows = 0
let unknownJudgeUsageCalls = 0
// What the policy could not see: proof of over-escalation, blind spots, and config that never fires.
let vetoedRounds = 0
let vetoAvoidedCost = 0
let vetoUnknownCostRows = 0
let upgradedRounds = 0
let unclassifiedRounds = 0
const firedRules = new Set<string>()

for (const row of rows) {
  byTier.set(row.tier, (byTier.get(row.tier) ?? 0) + 1)
  byRule.set(row.rule, (byRule.get(row.rule) ?? 0) + 1)
  byModel.set(row.upstreamModel, (byModel.get(row.upstreamModel) ?? 0) + 1)
  if (row.outcome !== 'ok') errors += 1
  if (row.outcome === 'transport') transports += 1
  if (row.judge) {
    judgeCalls += 1
    if (row.judge.status !== 'ok') judgeErrors += 1
    if (row.judge.cached) judgeCached += 1
    if (row.judge.overridden) {
      if (row.judge.direction === 'down') judgeOverridesDown += 1
      if (row.judge.direction === 'up') judgeOverridesUp += 1
    }
    if (!row.judge.cached && typeof row.judge.latencyMs === 'number') {
      judgeLatencyMs += row.judge.latencyMs
      judgeLatencyCount += 1
    }
    // Cache hits carry the usage of the original call; count the spend once per real call.
    if (!row.judge.cached) {
      const tokens = row.judge.usage?.inputTokens
      if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0) judgeInputTokens += tokens
      else unknownJudgeUsageCalls += 1
    }
  }
  firedRules.add(row.rule)
  if (row.rule === 'unclassified') unclassifiedRounds += 1
  if (row.judge?.overridden === true) {
    if (row.judge.direction === 'up') upgradedRounds += 1
    if (row.judge.direction === 'down') {
      vetoedRounds += 1
      // Same usage at the originally planned tier's rate: a rate-only figure, like the baseline.
      const planned = row.usage ? estimateCost(row.usage, config.models[row.judge.originalTier ?? '']?.cost) : undefined
      const served = row.cost?.total
      if (planned && typeof served === 'number' && Number.isFinite(served)) {
        vetoAvoidedCost += Math.max(0, planned.total - served)
      } else {
        vetoUnknownCostRows += 1
      }
    }
  }
  if (!row.usage) {
    unknownCostRows += 1
    unknownCounterfactualRows += 1
    continue
  }
  promptTokens += row.usage.promptTokens
  completionTokens += row.usage.completionTokens
  cachedTokens += row.usage.cachedTokens
  if (typeof row.cost?.total === 'number' && Number.isFinite(row.cost.total) && row.cost.total >= 0) cost += row.cost.total
  else unknownCostRows += 1
  const pricedBaseline = estimateCost(row.usage, strong?.cost)
  if (pricedBaseline) counterfactual += pricedBaseline.total
  else unknownCounterfactualRows += 1
}

const judgeRate = config.judge?.costPerMTokInput
const judgeCost = judgeCalls === 0 ? 0 : unknownJudgeUsageCalls > 0 || judgeRate === undefined ? null : (judgeInputTokens / 1e6) * judgeRate
const modelCost = unknownCostRows > 0 ? null : cost
const baselineCost = unknownCounterfactualRows > 0 ? null : counterfactual
const money = (value: number | null): string => value === null ? 'unknown' : `$${value.toFixed(4)}`
const pct = (value: number | null): string => value === null ? 'unknown' : `${value.toFixed(1)}%`

const formatMap = (map: Map<string, number>): string =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} ${count}`)
    .join(' · ') || '—'

const netCost = modelCost === null || judgeCost === null ? null : modelCost + judgeCost
const savings = baselineCost !== null && baselineCost > 0 && netCost !== null ? (1 - netCost / baselineCost) * 100 : null

// Discover: where the policy was wrong or blind, derived only from what the log actually recorded.
const configuredRules = Object.entries(config.policy)
  .filter(([, tier]) => tier !== 'off')
  .map(([rule]) => rule)
const rulesNeverFired = configuredRules.filter((rule) => !firedRules.has(rule))
const idleTiers = Object.keys(config.models).filter((tier) => !byTier.has(tier))
const unclassifiedSharePct = rows.length === 0 ? null : (unclassifiedRounds / rows.length) * 100
const avoidedCost = vetoUnknownCostRows > 0 ? null : vetoAvoidedCost
const discover = {
  vetoedRounds,
  avoidedCost,
  avoidedCostType: 'rate-only estimate',
  avoidedCostUnknownRows: vetoUnknownCostRows,
  upgradedRounds,
  unclassifiedRounds,
  unclassifiedSharePct,
  rulesNeverFired,
  idleTiers,
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        logFile,
        decisions: rows.length,
        sessions: sessions.size,
        unattributedRequests,
        unknownCostRows,
        unknownCounterfactualRows,
        unknownJudgeUsageCalls,
        errors,
        transports,
        byTier: Object.fromEntries(byTier),
        byRule: Object.fromEntries(byRule),
        byModel: Object.fromEntries(byModel),
        promptTokens,
        completionTokens,
        cachedTokens,
        cost: modelCost,
        knownCostSubtotal: cost,
        judgeCost,
        netCost,
        counterfactual: baselineCost,
        savingsPct: savings,
        counterfactualType: 'estimate',
        discover,
        judge: {
          calls: judgeCalls,
          errors: judgeErrors,
          cached: judgeCached,
          overridesDown: judgeOverridesDown,
          overridesUp: judgeOverridesUp,
          avgLatencyMs: judgeLatencyCount ? Math.round(judgeLatencyMs / judgeLatencyCount) : 0,
          inputTokens: judgeInputTokens,
          cost: judgeCost,
        },
      },
      null,
      2,
    ),
  )
} else {
  console.log(`Sabi report — ${logFile}`)
  console.log(`decisions ${rows.length} · known sessions ${sessions.size} · unattributed requests ${unattributedRequests} · errors ${errors} · transport ${transports}`)
  console.log('')
  console.log(`by tier   ${formatMap(byTier)}`)
  console.log(`by rule   ${formatMap(byRule)}`)
  console.log(`by model  ${formatMap(byModel)}`)
  if (judgeCalls > 0) {
    const avg = judgeLatencyCount ? Math.round(judgeLatencyMs / judgeLatencyCount) : 0
    console.log(
      `judge     ${judgeCalls} calls (${judgeCalls - judgeErrors} ok, ${judgeErrors} failed, ${judgeCached} cached)` +
        ` · ${judgeOverridesDown} downgrades, ${judgeOverridesUp} upgrades · avg ${avg}ms · ${judgeInputTokens} known tok · cost ${money(judgeCost)}`,
    )
  }
  console.log('')
  console.log('discover (what the policy could not see)')
  console.log(
    `  judge vetoes    ${vetoedRounds} downgraded · ${money(avoidedCost)} avoided at the same usage (rate-only)`,
  )
  console.log(`  judge upgrades  ${upgradedRounds} escalated after a difficulty override`)
  console.log(
    `  blind spots     ${unclassifiedRounds} unclassified rounds (${pct(unclassifiedSharePct)} of decisions) — no policy signal`,
  )
  console.log(`  never fired     ${rulesNeverFired.join(', ') || '—'}`)
  console.log(`  idle tiers      ${idleTiers.join(', ') || '—'}`)
  console.log('')
  console.log(
    `tokens    in ${promptTokens.toLocaleString()} (cached ${cachedTokens.toLocaleString()}) · out ${completionTokens.toLocaleString()}`,
  )
  console.log(
    `cost      ${money(modelCost)} (net ${money(netCost)} with judge) · all-${strong ? 'strong' : 'baseline'} counterfactual ${money(baselineCost)} · savings ${savings === null ? 'unknown' : `${savings.toFixed(1)}%`} (rate-only estimate)`,
  )
}
