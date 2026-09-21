import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { CostBreakdown, CostRates, DecisionRecord, UsageTotals } from './types.ts'

/** Decisions land beside the work, not beside the installation: `./.sabi/decisions.jsonl`. */
export function defaultLogPath(): string {
  return process.env.SABI_LOG?.trim() || path.join(process.cwd(), '.sabi', 'decisions.jsonl')
}

/** Own-user-only JSONL append, shared by the decision, council and surplus logs.
 * `mode` on mkdirSync/appendFileSync only applies at *creation* — an install upgrading from
 * before this hardening existed would keep its old, looser permissions on every later append
 * unless the mode is also asserted explicitly here. No-op on Windows, where POSIX permission
 * bits don't apply. */
export function appendPrivateLine(logFile: string, line: string): void {
  const dir = path.dirname(logFile)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  appendFileSync(logFile, line, { mode: 0o600 })
  if (process.platform !== 'win32') {
    chmodSync(dir, 0o700)
    chmodSync(logFile, 0o600)
  }
}

export function appendDecision(record: DecisionRecord, logFile = defaultLogPath()): void {
  appendPrivateLine(logFile, `${JSON.stringify(record)}\n`)
}

/** One JSON object per line, malformed lines skipped — the read side of `appendDecision`.
 * Missing file returns an empty array rather than throwing: no traffic yet is not an error. */
export function readDecisions(logFile = defaultLogPath()): DecisionRecord[] {
  if (!existsSync(logFile)) return []
  const rows: DecisionRecord[] = []
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line) as DecisionRecord)
    } catch {
      // skip malformed line
    }
  }
  return rows
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
