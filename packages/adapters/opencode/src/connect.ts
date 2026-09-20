#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, minContextWindowFor, minOutputTokensFor, tiersFor, type SabiConfig } from '@sabi/core'

/**
 * Adds Sabi to OpenCode as an OpenAI-compatible provider. Verified against OpenCode 1.18.30: a real
 * `opencode run --model sabi/sabi-code` session reached a local Sabi, completed a tool round, and was
 * recorded with `client: opencode` (2026-09-18). The writer only ever merges `provider.sabi` and
 * leaves the existing providers, credentials and default model alone unless --set-default is passed.
 */
const configPath =
  process.env.SABI_OPENCODE_CONFIG ?? path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
const baseURL = process.env.SABI_BASE_URL ?? 'http://127.0.0.1:8787/v1'
const setDefault = process.argv.includes('--set-default')
const includeLocal = process.argv.includes('--include-local')
const smallModelArgument = process.argv.find((argument) => argument.startsWith('--small-model='))
const smallModel = smallModelArgument?.slice('--small-model='.length).trim()
if (smallModelArgument && !smallModel) {
  console.error('--small-model requires a non-empty provider/model value')
  process.exit(1)
}
const backupPath = `${configPath}.sabi-backup`

const PROVIDER_ID = 'sabi'
const ADAPTIVE_ALIAS = 'sabi-code'
/** The provider's key is never the upstream credential: Sabi holds those, and the endpoint is local. */
const PLACEHOLDER_KEY = 'sabi-local-placeholder'
/**
 * OpenCode requires BOTH `limit.context` and `limit.output` when a model declares a limit (verified:
 * it rejects the config otherwise). Sabi does not cap output itself, so an undeclared tier gets this
 * conservative client-side cap — raise it by declaring `maxOutputTokens` on the tier.
 */
const DEFAULT_OUTPUT_TOKENS = 4096

const displayNames: Record<string, string> = {
  'sabi-code': 'Sabi Code (adaptive)',
  'sabi-cheap': 'Sabi Cheap (baseline)',
  'sabi-mid': 'Sabi Mid (baseline)',
  'sabi-strong': 'Sabi Strong (baseline)',
  'sabi-quality': 'Sabi Quality (free OpenRouter lane)',
  'sabi-local': 'Sabi Local (ollama)',
}

/**
 * OpenCode model entries. Input modalities are advertised per alias from the tiers that alias can
 * serve: `image` appears only where a reachable tier affirmatively declares it, so OpenCode sends
 * images exactly where Sabi's capability routing can honour them (adaptive rounds fall forward to
 * the first image-capable tier with `rule: capability`; a fixed text-only alias refuses with 400
 * instead of answering blind). An alias whose tiers declare nothing stays text-only.
 */
export function sabiModels(
  config: SabiConfig,
  options: { includeLocal: boolean },
): Record<string, Record<string, unknown>> {
  const models: Record<string, Record<string, unknown>> = {}
  for (const [alias, target] of Object.entries(config.aliases)) {
    if (config.models[target]?.upstream === 'ollama' && !options.includeLocal) continue
    const servesImage = tiersFor(config, target).some((tier) =>
      config.models[tier]?.capabilities?.inputModalities?.includes('image'),
    )
    const entry: Record<string, unknown> = {
      name: displayNames[alias] ?? alias,
      tool_call: true,
      modalities: { input: servesImage ? ['text', 'image'] : ['text'], output: ['text'] },
    }
    // OpenCode wants both limit keys together, so a limit appears only when a window is knowable.
    const context = minContextWindowFor(config, target)
    if (context) entry.limit = { context, output: minOutputTokensFor(config, target) ?? DEFAULT_OUTPUT_TOKENS }
    models[alias] = entry
  }
  return models
}

export function sabiProvider(config: SabiConfig, url: string, options: { includeLocal: boolean }): Record<string, unknown> {
  return {
    npm: '@ai-sdk/openai-compatible',
    name: 'Sabi (local adaptive proxy)',
    options: {
      baseURL: url,
      apiKey: PLACEHOLDER_KEY,
      // Sabi records this as `client` and hashes it; it carries no permission and never goes upstream.
      headers: { 'X-Sabi-Client': 'opencode' },
    },
    models: sabiModels(config, options),
  }
}

export function mergeProvider(
  existing: Record<string, unknown>,
  provider: Record<string, unknown>,
  options: { setDefault: boolean; smallModel?: string },
): Record<string, unknown> {
  const providers = (existing.provider ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...existing, provider: { ...providers, [PROVIDER_ID]: provider } }
  if (options.setDefault) {
    merged.model = `${PROVIDER_ID}/${ADAPTIVE_ALIAS}`
  }
  if (options.smallModel) merged.small_model = options.smallModel
  else if (options.setDefault) merged.small_model = `${PROVIDER_ID}/${ADAPTIVE_ALIAS}`
  return merged
}

function readConfig(): Record<string, unknown> {
  if (!existsSync(configPath)) return { $schema: 'https://opencode.ai/config.json' }
  const text = readFileSync(configPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.error(`Refusing to touch ${configPath}: invalid JSON (${(error as Error).message})`)
    process.exit(1)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`Refusing to touch ${configPath}: expected a JSON object at the top level`)
    process.exit(1)
  }
  return parsed as Record<string, unknown>
}

const config = loadConfig()
const existing = readConfig()
const provider = sabiProvider(config, baseURL, { includeLocal })
const others = Object.keys((existing.provider ?? {}) as Record<string, unknown>).filter((id) => id !== PROVIDER_ID)
const previousDefault = typeof existing.model === 'string' ? existing.model : '(unset)'
const merged = mergeProvider(existing, provider, { setDefault, smallModel })

mkdirSync(path.dirname(configPath), { recursive: true })
// One backup, never rewritten: a re-run must not overwrite the pre-Sabi original with Sabi's own edit.
if (existsSync(configPath) && !existsSync(backupPath)) copyFileSync(configPath, backupPath)
writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`)

console.log(`Updated ${configPath}`)
console.log(`  provider "${PROVIDER_ID}" -> ${baseURL} (keyless local endpoint, placeholder key)`)
for (const [id, entry] of Object.entries(provider.models as Record<string, Record<string, unknown>>)) {
  const limit = entry.limit as { context?: number } | undefined
  console.log(`    ${id.padEnd(12)} ${String(entry.name)}${limit?.context ? ` · ctx ${limit.context.toLocaleString()}` : ' · ctx unknown'}`)
}
if (!includeLocal) {
  console.log('  sabi-local (ollama qwen2.5-coder:7b) skipped — rerun with --include-local to expose it')
}
const declaredOutput = minOutputTokensFor(config, config.aliases[ADAPTIVE_ALIAS] ?? 'auto')
console.log(
  declaredOutput
    ? `  output cap: ${declaredOutput.toLocaleString()} (declared maxOutputTokens)`
    : `  output cap: ${DEFAULT_OUTPUT_TOKENS.toLocaleString()} (client default; declare maxOutputTokens on a tier to change it)`,
)
console.log(`  existing providers preserved: ${others.join(', ') || '(none)'}`)
if (setDefault) {
  console.log(`  default model set to ${PROVIDER_ID}/${ADAPTIVE_ALIAS} (was ${previousDefault})`)
} else {
  console.log(`  default model left as ${previousDefault} — add --set-default, or pick it per run with --model ${PROVIDER_ID}/${ADAPTIVE_ALIAS}`)
}
if (smallModel) console.log(`  small model set to ${smallModel} (OpenCode utility work only; Sabi still owns adaptive coding rounds)`)
if (existsSync(backupPath)) console.log(`  backup: ${backupPath} (created once, never overwritten)`)
console.log('')
console.log(`Next: start Sabi (npm start), then run it: opencode run --model ${PROVIDER_ID}/${ADAPTIVE_ALIAS} "your task"`)
console.log('Verify: the round appears in .sabi/decisions.jsonl with client "opencode" (npm run report).')
console.log(`Rollback: remove the "${PROVIDER_ID}" provider from ${configPath}, or restore ${backupPath}.`)
