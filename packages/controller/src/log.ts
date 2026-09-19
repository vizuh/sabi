import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ControllerAction, ControllerDecisionRecord } from './types.ts'

export interface ControllerReplaySummary {
  sampleSize: number
  actions: Record<ControllerAction, number>
  execution: Record<string, number>
  rules: Record<string, number>
  acceptedExecutions: number
  completedExecutions: number
  failedExecutions: number
  averageDurationMs?: number
}

/** Own log, own file — the record shape differs from `@sabi/core`'s `DecisionRecord`, so this
 * mirrors `core/src/log.ts`'s append/read pair rather than reusing it. */
export function defaultControllerLogPath(cwd: string): string {
  return process.env.SABI_CONTROLLER_LOG?.trim() || path.join(cwd, '.sabi', 'controller-decisions.jsonl')
}

export function appendControllerDecision(record: ControllerDecisionRecord, logFile: string): void {
  mkdirSync(path.dirname(logFile), { recursive: true })
  appendFileSync(logFile, `${JSON.stringify(record)}\n`)
}

/** One JSON object per line, malformed lines skipped. Missing file returns an empty array.
 * Unused today (no caller in this repo) — only guards JSON.parse failure, not row shape, same
 * gap `stuckSessionSignal()` had before it was root-caused. Guard shape here too before wiring
 * a real reader (e.g. a future `controller history` subcommand) against this. */
export function readControllerDecisions(logFile: string): ControllerDecisionRecord[] {
  if (!existsSync(logFile)) return []
  const rows: ControllerDecisionRecord[] = []
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows.push(parsed as ControllerDecisionRecord)
      }
    } catch {
      // skip malformed line
    }
  }
  return rows
}

export function summarizeControllerReplay(records: ControllerDecisionRecord[]): ControllerReplaySummary {
  const actions: Record<ControllerAction, number> = {
    CONTINUE: 0,
    DELEGATE: 0,
    SPAWN: 0,
    ORCHESTRATE: 0,
    ASK: 0,
  }
  const execution: Record<string, number> = Object.create(null) as Record<string, number>
  const rules: Record<string, number> = Object.create(null) as Record<string, number>
  let acceptedExecutions = 0
  let completedExecutions = 0
  let failedExecutions = 0
  let durationTotal = 0
  let durationCount = 0

  for (const record of records) {
    if (Object.hasOwn(actions, record.action)) actions[record.action] += 1
    rules[record.rule] = (rules[record.rule] ?? 0) + 1
    const status = record.execution?.status
    if (status) {
      execution[status] = (execution[status] ?? 0) + 1
      if (status === 'started' || status === 'completed' || status === 'rerouted') acceptedExecutions += 1
      if (status === 'completed') completedExecutions += 1
      if (status === 'failed') failedExecutions += 1
    }
    const durationMs = record.execution?.durationMs
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
      durationTotal += durationMs
      durationCount += 1
    }
  }

  return {
    sampleSize: records.length,
    actions,
    execution,
    rules,
    acceptedExecutions,
    completedExecutions,
    failedExecutions,
    ...(durationCount ? { averageDurationMs: Math.round(durationTotal / durationCount) } : {}),
  }
}
