#!/usr/bin/env node
import path from 'node:path'
import { decide } from './decide.ts'
import { appendControllerDecision, defaultControllerLogPath } from './log.ts'
import { gatherSignals } from './signals.ts'
import type { ControllerDecisionRecord } from './types.ts'

function flagValue(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
}

function main(): void {
  const argv = process.argv.slice(2)
  const cwd = path.resolve(flagValue(argv, '--cwd') ?? process.cwd())
  const orchestrateFlag = argv.includes('--orchestrate')
  const asJson = argv.includes('--json')
  // Join every non-flag token instead of taking just the first — the documented invocation is a
  // quoted string, but an unquoted multi-word request (a human typo, not an error) must not
  // silently truncate to its first word.
  const requestParts = argv.filter((a) => !a.startsWith('--'))
  const requestText = requestParts.length > 0 ? requestParts.join(' ') : undefined

  const signals = gatherSignals(cwd, requestText, orchestrateFlag)
  const decision = decide(signals)
  const record: ControllerDecisionRecord = { ...decision, ts: new Date().toISOString(), cwd, signals }
  appendControllerDecision(record, defaultControllerLogPath(cwd))

  if (asJson) {
    console.log(JSON.stringify(record, null, 2))
  } else {
    console.log(`[CONTROLLER] ${decision.action} — ${decision.rule}`)
    console.log(decision.reason)
    console.log('(advisory only — no action taken)')
  }
}

main()
