import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ControllerDecisionRecord } from './types.ts'

/** Own log, own file — the record shape differs from `@sabi/core`'s `DecisionRecord`, so this
 * mirrors `core/src/log.ts`'s append/read pair rather than reusing it. */
export function defaultControllerLogPath(cwd: string): string {
  return process.env.SABI_CONTROLLER_LOG?.trim() || path.join(cwd, '.sabi', 'controller-decisions.jsonl')
}

export function appendControllerDecision(record: ControllerDecisionRecord, logFile: string): void {
  mkdirSync(path.dirname(logFile), { recursive: true })
  appendFileSync(logFile, `${JSON.stringify(record)}\n`)
}

/** One JSON object per line, malformed lines skipped. Missing file returns an empty array. */
export function readControllerDecisions(logFile: string): ControllerDecisionRecord[] {
  if (!existsSync(logFile)) return []
  const rows: ControllerDecisionRecord[] = []
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line) as ControllerDecisionRecord)
    } catch {
      // skip malformed line
    }
  }
  return rows
}
