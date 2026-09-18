import { appendFileSync, mkdirSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { CostBreakdown, CostRates, DecisionRecord, UsageTotals } from './types.ts'

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

/** Domain-separated hashes keep untrusted client/tool identifiers out of logs. */
export function hashIdentity(kind: 'session' | 'turn' | 'tool', ...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify([kind, ...parts])).digest('hex')
}

/** No explicit session means no grouping. Never derive identity from prompt content. */
export function sessionIdFor(session?: string, client = 'unknown'): string {
  return session === undefined ? randomUUID() : hashIdentity('session', client, session)
}

export function estimateCost(usage: UsageTotals, rates?: CostRates): CostBreakdown | undefined {
  if (!rates || ![rates.input, rates.output, rates.cacheRead ?? rates.input]
    .every((rate) => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0)) return undefined
  if (![usage.promptTokens, usage.completionTokens, usage.cachedTokens, usage.totalTokens]
    .every((tokens) => Number.isSafeInteger(tokens) && tokens >= 0)) return undefined
  const cached = Math.max(0, Math.min(usage.cachedTokens, usage.promptTokens))
  const uncached = Math.max(0, usage.promptTokens - cached)
  const input = (uncached * rates.input + cached * (rates.cacheRead ?? rates.input)) / 1e6
  const output = (usage.completionTokens * rates.output) / 1e6
  const total = input + output
  return [input, output, total].every(Number.isFinite) ? { input, output, total } : undefined
}
