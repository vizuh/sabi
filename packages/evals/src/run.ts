#!/usr/bin/env node
import { loadConfig } from '@sabi/core'
import { formatSummary, runEval } from './harness.ts'
import { TASK_SET } from './tasks.ts'

const config = loadConfig()
const baselineTier = process.argv[2] ?? 'mid'

const summary = runEval(
  {
    policy: config.policy,
    models: config.models,
    baselineTier,
    contextWindow: config.harness?.contextWindow,
  },
  TASK_SET,
)

console.log(formatSummary(summary))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2))
}