import { appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { textOf } from './state.ts'
import type { ChatRequestBody, CostBreakdown, CostRates, DecisionRecord, UsageTotals } from './types.ts'

/** Decisions land beside the work, not beside the installation: `./.sabi/decisions.jsonl`. */
export function defaultLogPath(): string {
  return process.env.SABI_LOG?.trim() || path.join(process.cwd(), '.sabi', 'decisions.jsonl')
}

export function appendDecision(record: DecisionRecord, logFile = defaultLogPath()): void {
  mkdirSync(path.dirname(logFile), { recursive: true })
  appendFileSync(logFile, `${JSON.stringify(record)}\n`)
}

export function emptyUsage(): UsageTotals {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 }
}

export function sessionIdFor(body: ChatRequestBody): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((message) => message?.role === 'system')
  const user = messages.find((message) => message?.role === 'user')
  const basis = `${textOf(system?.content).slice(0, 2000)}::${textOf(user?.content).slice(0, 500)}`
  return createHash('sha1').update(basis).digest('hex').slice(0, 12)
}

export function estimateCost(usage: UsageTotals, rates?: CostRates): CostBreakdown {
  if (!rates) return { input: 0, output: 0, total: 0 }
  const cached = Math.max(0, Math.min(usage.cachedTokens, usage.promptTokens))
  const uncached = Math.max(0, usage.promptTokens - cached)
  const input = (uncached * rates.input + cached * (rates.cacheRead ?? rates.input)) / 1e6
  const output = (usage.completionTokens * rates.output) / 1e6
  return { input, output, total: input + output }
}
