#!/usr/bin/env node
import path from 'node:path'
import { runController } from './controller.ts'
import { appendControllerDecision, defaultControllerLogPath } from './log.ts'
import { gatherSignals } from './signals.ts'
import type { ControllerDecisionRecord, ControllerOverride } from './types.ts'

function flagValue(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cwd = path.resolve(flagValue(argv, '--cwd') ?? process.cwd())
  const orchestrateFlag = argv.includes('--orchestrate')
  const asJson = argv.includes('--json')
  const waitMs = Number(flagValue(argv, '--wait-ms') ?? 5000)
  const override: ControllerOverride | undefined = (() => {
    const sessionId = flagValue(argv, '--session')
    const harness = flagValue(argv, '--harness') ?? flagValue(argv, '--agent')
    return sessionId || harness ? { ...(sessionId ? { sessionId } : {}), ...(harness ? { harness } : {}) } : undefined
  })()
  // Join every non-flag token instead of taking just the first — the documented invocation is a
  // quoted string, but an unquoted multi-word request (a human typo, not an error) must not
  // silently truncate to its first word.
  const requestParts = argv.filter((a) => !a.startsWith('--'))
  const requestText = requestParts.length > 0 ? requestParts.join(' ') : undefined

  const signals = gatherSignals(cwd, requestText, orchestrateFlag)
  const result = await runController(requestText ?? '', cwd, signals, override, Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 5000)
  const record: ControllerDecisionRecord = {
    action: result.selection.action,
    rule: result.selection.rule,
    reason: result.selection.reason,
    ts: new Date().toISOString(),
    cwd,
    signals,
    ...(requestText ? { request: requestText } : {}),
    ...(override ? { override } : {}),
    handoff: result.handoff,
    target: result.selection.target,
    routing: result.routing,
    execution: result.execution,
  }
  appendControllerDecision(record, defaultControllerLogPath(cwd))

  if (asJson) {
    console.log(JSON.stringify(record, null, 2))
  } else {
    console.log(`[CONTROLLER] ${record.action} — ${record.rule}`)
    console.log(record.reason)
    console.log(`execution: ${record.execution?.status ?? 'unknown'}`)
  }

  if (result.execution.status === 'failed') process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(`[CONTROLLER] failed — ${(error as Error).message}`)
  process.exitCode = 1
})
