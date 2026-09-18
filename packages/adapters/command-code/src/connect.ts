#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, type SabiConfig } from '@sabi/core'

const providersPath =
  process.env.SABI_CC_PROVIDERS ?? path.join(os.homedir(), '.commandcode', 'providers.json')
const baseURL = process.env.SABI_BASE_URL ?? 'http://127.0.0.1:8787/v1'
const includeLocal = process.argv.includes('--include-local')

const displayNames: Record<string, string> = {
  'sabi-code': 'Sabi Code (adaptive)',
  'sabi-cheap': 'Sabi Cheap (baseline)',
  'sabi-mid': 'Sabi Mid (baseline)',
  'sabi-strong': 'Sabi Strong (baseline)',
  'sabi-local': 'Sabi Local (ollama)',
}

function minContextWindow(config: SabiConfig, target: string): number | undefined {
  if (target !== 'auto') return config.models[target]?.contextWindow
  const policyTiers = Object.values(config.policy).filter((tier) => tier !== 'off' && config.models[tier])
  const candidates = policyTiers.length ? [...new Set(policyTiers)] : Object.keys(config.models)
  const windows = candidates
    .map((tier) => config.models[tier]?.contextWindow)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  return windows.length ? Math.min(...windows) : undefined
}

function readProviders(): Record<string, unknown> {
  if (!existsSync(providersPath)) return { provider: {} }
  const text = readFileSync(providersPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.error(`Refusing to touch ${providersPath}: invalid JSON (${(error as Error).message})`)
    process.exit(1)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`Refusing to touch ${providersPath}: expected a JSON object at the top level`)
    process.exit(1)
  }
  return parsed as Record<string, unknown>
}

const config = loadConfig()
const file = readProviders()
const provider = (file.provider ?? {}) as Record<string, unknown>

const models: Record<string, { name: string; contextWindow?: number }> = {}
for (const [alias, target] of Object.entries(config.aliases)) {
  if (config.models[target]?.upstream === 'ollama' && !includeLocal) continue
  const entry: { name: string; contextWindow?: number } = { name: displayNames[alias] ?? alias }
  const contextWindow = minContextWindow(config, target)
  if (contextWindow) entry.contextWindow = contextWindow
  models[alias] = entry
}

provider.sabi = {
  name: 'Sabi',
  baseURL,
  apiKey: false,
  models,
}
file.provider = provider

mkdirSync(path.dirname(providersPath), { recursive: true })
writeFileSync(providersPath, `${JSON.stringify(file, null, 2)}\n`)

const subjects = Object.keys(provider)
console.log(`Updated ${providersPath}`)
console.log(`  provider "sabi" -> ${baseURL} (keyless local endpoint)`)
for (const [id, entry] of Object.entries(models)) {
  console.log(`    ${id.padEnd(12)} ${entry.name}${entry.contextWindow ? ` · ctx ${entry.contextWindow.toLocaleString()}` : ''}`)
}
if (!includeLocal) {
  console.log('  sabi-local (ollama qwen2.5-coder:7b) skipped — rerun with --include-local to expose it')
}
console.log(`  existing providers preserved: ${subjects.filter((id) => id !== 'sabi').join(', ') || '(none)'}`)
console.log('')
console.log('Next: start Sabi (npm start), then in Command Code run /model — "Sabi" appears as a provider.')
console.log('Verify headlessly with: cmd --list-models | grep sabi')
