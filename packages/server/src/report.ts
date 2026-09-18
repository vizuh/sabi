#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { defaultLogPath, estimateCost, loadConfig, type DecisionRecord } from '@sabi/core'

const config = loadConfig()
const logFile = process.env.SABI_LOG ?? defaultLogPath()
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
const sessions = new Set(rows.map((row) => row.sessionId))
const byTier = new Map<string, number>()
const byRule = new Map<string, number>()
const byModel = new Map<string, number>()
let promptTokens = 0
let completionTokens = 0
let cachedTokens = 0
let cost = 0
let counterfactual = 0
let errors = 0

for (const row of rows) {
  byTier.set(row.tier, (byTier.get(row.tier) ?? 0) + 1)
  byRule.set(row.rule, (byRule.get(row.rule) ?? 0) + 1)
  byModel.set(row.upstreamModel, (byModel.get(row.upstreamModel) ?? 0) + 1)
  if (row.outcome !== 'ok') errors += 1
  if (!row.usage) continue
  promptTokens += row.usage.promptTokens
  completionTokens += row.usage.completionTokens
  cachedTokens += row.usage.cachedTokens
  cost += row.cost?.total ?? 0
  counterfactual += estimateCost(row.usage, strong?.cost).total
}

const formatMap = (map: Map<string, number>): string =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} ${count}`)
    .join(' · ') || '—'

const savings = counterfactual > 0 ? (1 - cost / counterfactual) * 100 : 0

if (asJson) {
  console.log(
    JSON.stringify(
      {
        logFile,
        decisions: rows.length,
        sessions: sessions.size,
        errors,
        byTier: Object.fromEntries(byTier),
        byRule: Object.fromEntries(byRule),
        byModel: Object.fromEntries(byModel),
        promptTokens,
        completionTokens,
        cachedTokens,
        cost,
        counterfactual,
        savingsPct: savings,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`Sabi report — ${logFile}`)
  console.log(`decisions ${rows.length} · sessions ${sessions.size} · errors ${errors}`)
  console.log('')
  console.log(`by tier   ${formatMap(byTier)}`)
  console.log(`by rule   ${formatMap(byRule)}`)
  console.log(`by model  ${formatMap(byModel)}`)
  console.log('')
  console.log(
    `tokens    in ${promptTokens.toLocaleString()} (cached ${cachedTokens.toLocaleString()}) · out ${completionTokens.toLocaleString()}`,
  )
  console.log(
    `cost      $${cost.toFixed(4)} · all-${strong ? 'strong' : 'baseline'} counterfactual $${counterfactual.toFixed(4)} · savings ${savings.toFixed(1)}%`,
  )
}
