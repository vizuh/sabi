import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SabiConfig } from './types.ts'

const CONFIG_FILE = 'sabi.config.json'

/** `packages/core` in the repo, or the package root when installed under node_modules. */
export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))

export interface ConfigSearchOptions {
  cwd?: string
  packageRoot?: string
  env?: NodeJS.ProcessEnv
}

function userConfigPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(base, 'sabi', CONFIG_FILE)
}

function nearestConfigAbove(start: string): string | undefined {
  let dir = path.resolve(start)
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Every path Sabi reads, in order of precedence: `$SABI_CONFIG` (alone, when set), the
 * working directory, the user config dir, then the nearest config above the installed
 * package — which is how a clone finds the `sabi.config.json` it shipped with.
 */
export function configSearchPaths(options: ConfigSearchOptions = {}): string[] {
  const env = options.env ?? process.env
  const explicit = env.SABI_CONFIG?.trim()
  if (explicit) return [explicit]
  const candidates = [
    path.join(options.cwd ?? process.cwd(), CONFIG_FILE),
    userConfigPath(env),
  ]
  const above = nearestConfigAbove(options.packageRoot ?? PACKAGE_ROOT)
  if (above) candidates.push(above)
  return candidates
}

export function defaultConfigPath(options: ConfigSearchOptions = {}): string {
  const candidates = configSearchPaths(options)
  return candidates.find((candidate) => existsSync(candidate)) ?? (candidates[0] as string)
}

export function loadConfig(configPath = defaultConfigPath()): SabiConfig {
  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    const searched = configSearchPaths()
    const hint =
      searched.length > 1
        ? `searched: ${searched.join(', ')} — set SABI_CONFIG to point at one`
        : 'set SABI_CONFIG to point at one'
    throw new Error(`Sabi config not found at ${configPath} (${hint})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Sabi config ${configPath} is not valid JSON: ${(error as Error).message}`)
  }
  return validateConfig(parsed, configPath)
}

const MODALITIES = ['text', 'image', 'audio', 'video', 'file']

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateModelMetadata(value: unknown, label: string): void {
  if (!isObject(value)) throw new Error(`${label} must be an object`)
  const fail = (field: string, expected: string): never => {
    throw new Error(`${label}.${field} ${expected}`)
  }
  const integer = (number: unknown, field: string, minimum = 1): void => {
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum) {
      fail(field, `must be a safe integer >= ${minimum}`)
    }
  }
  for (const field of ['contextWindow', 'maxOutputTokens'] as const) {
    if (value[field] !== undefined) integer(value[field], field)
  }
  if (typeof value.contextWindow === 'number' && typeof value.maxOutputTokens === 'number' &&
      value.maxOutputTokens > value.contextWindow) {
    fail('maxOutputTokens', 'cannot exceed contextWindow')
  }
  if (value.capabilities !== undefined) {
    if (!isObject(value.capabilities)) fail('capabilities', 'must be an object')
    const capabilities = value.capabilities as Record<string, unknown>
    const fields = ['tools', 'parallelTools', 'strictTools', 'inputModalities', 'outputModalities',
      'structuredOutput', 'reasoningEfforts', 'supportedParameters']
    for (const field of Object.keys(capabilities)) {
      if (!fields.includes(field)) fail(`capabilities.${field}`, 'is not a supported metadata field')
    }
    for (const field of ['tools', 'parallelTools', 'strictTools']) {
      if (capabilities[field] !== undefined && typeof capabilities[field] !== 'boolean') {
        fail(`capabilities.${field}`, 'must be a boolean')
      }
    }
    if (capabilities.tools === false && (capabilities.parallelTools === true || capabilities.strictTools === true)) {
      fail('capabilities.tools', 'cannot be false when parallelTools or strictTools is true')
    }
    for (const field of ['inputModalities', 'outputModalities', 'structuredOutput', 'reasoningEfforts', 'supportedParameters']) {
      const items = capabilities[field]
      if (items === undefined) continue
      if (!Array.isArray(items) || items.some((item) => typeof item !== 'string' || !item.trim())) {
        fail(`capabilities.${field}`, 'must be an array of nonempty strings')
      }
      const strings = items as string[]
      if (new Set(strings).size !== strings.length) fail(`capabilities.${field}`, 'must not contain duplicates')
      const allowed = field.endsWith('Modalities') ? MODALITIES : field === 'structuredOutput' ? ['json_object', 'json_schema'] : undefined
      if (allowed && strings.some((item) => !allowed.includes(item))) {
        fail(`capabilities.${field}`, `must contain only: ${allowed.join(', ')}`)
      }
    }
  }
  if (value.contextAccounting !== undefined) {
    if (!isObject(value.contextAccounting)) fail('contextAccounting', 'must be an object')
    const accounting = value.contextAccounting as Record<string, unknown>
    for (const field of Object.keys(accounting)) {
      if (!['textTokensPerByte', 'requestOverheadTokens', 'perMessageOverheadTokens', 'mediaTokens'].includes(field)) {
        fail(`contextAccounting.${field}`, 'is not a supported metadata field')
      }
    }
    if (typeof accounting.textTokensPerByte !== 'number' || !Number.isFinite(accounting.textTokensPerByte) || accounting.textTokensPerByte <= 0) {
      fail('contextAccounting.textTokensPerByte', 'must be a positive finite number')
    }
    integer(accounting.requestOverheadTokens, 'contextAccounting.requestOverheadTokens', 0)
    integer(accounting.perMessageOverheadTokens, 'contextAccounting.perMessageOverheadTokens', 0)
    if (accounting.mediaTokens !== undefined) {
      if (!isObject(accounting.mediaTokens)) fail('contextAccounting.mediaTokens', 'must be an object')
      for (const [modality, tokens] of Object.entries(accounting.mediaTokens as Record<string, unknown>)) {
        if (!MODALITIES.slice(1).includes(modality)) fail(`contextAccounting.mediaTokens.${modality}`, 'is not a supported modality')
        integer(tokens, `contextAccounting.mediaTokens.${modality}`)
      }
    }
  }
  if (value.cost !== undefined) {
    if (!isObject(value.cost)) fail('cost', 'must be an object')
    const rates = value.cost as Record<string, unknown>
    for (const field of ['input', 'output', ...(rates.cacheRead !== undefined ? ['cacheRead'] : [])]) {
      if (typeof rates[field] !== 'number' || !Number.isFinite(rates[field]) || (rates[field] as number) < 0) {
        fail(`cost.${field}`, 'must be a nonnegative finite number')
      }
    }
  }
}

export function validateConfig(value: unknown, source = '<inline>'): SabiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Sabi config ${source}: expected a JSON object`)
  }
  const config = value as SabiConfig
  const upstreams = config.upstreams ?? {}
  const models = config.models ?? {}
  const aliases = config.aliases ?? {}
  const policy = config.policy ?? {}

  for (const [name, entries] of Object.entries({ upstreams, models, aliases, policy })) {
    if (!isObject(entries)) throw new Error(`Sabi config ${source}: ${name} must be an object`)
  }
  if (config.compatibility !== undefined) {
    if (!isObject(config.compatibility) || !['legacy', 'strict'].includes(config.compatibility.mode)) {
      throw new Error(`Sabi config ${source}: compatibility.mode must be 'legacy' or 'strict'`)
    }
    if (Object.keys(config.compatibility).some((field) => field !== 'mode')) {
      throw new Error(`Sabi config ${source}: compatibility has an unknown field`)
    }
  }

  if (!Object.keys(upstreams).length) throw new Error(`Sabi config ${source}: no upstreams declared`)
  for (const [name, upstream] of Object.entries(upstreams)) {
    if (!upstream || typeof upstream.baseURL !== 'string' || !upstream.baseURL) {
      throw new Error(`Sabi config ${source}: upstream '${name}' has no baseURL`)
    }
    try {
      new URL(upstream.baseURL)
    } catch {
      throw new Error(`Sabi config ${source}: upstream '${name}' has an invalid baseURL`)
    }
  }

  if (!Object.keys(models).length) throw new Error(`Sabi config ${source}: no models declared`)
  for (const [name, model] of Object.entries(models)) {
    validateModelMetadata(model, `Sabi config ${source}: model tier '${name}'`)
    if (!model || typeof model.model !== 'string' || !model.model) {
      throw new Error(`Sabi config ${source}: model tier '${name}' has no model id`)
    }
    if (typeof model.upstream !== 'string' || !Object.hasOwn(upstreams, model.upstream)) {
      throw new Error(`Sabi config ${source}: model tier '${name}' references unknown upstream '${model.upstream}'`)
    }
  }

  if (!Object.keys(aliases).length) throw new Error(`Sabi config ${source}: no aliases declared`)
  for (const [alias, target] of Object.entries(aliases)) {
    if (typeof target !== 'string' || (target !== 'auto' && !Object.hasOwn(models, target))) {
      throw new Error(`Sabi config ${source}: alias '${alias}' targets unknown tier '${target}'`)
    }
  }

  for (const [condition, tier] of Object.entries(policy)) {
    if (typeof tier !== 'string' || (tier !== 'off' && !Object.hasOwn(models, tier))) {
      throw new Error(`Sabi config ${source}: policy rule '${condition}' targets unknown tier '${tier}'`)
    }
  }

  const judge = config.judge
  if (judge !== undefined) {
    if (typeof judge !== 'object' || judge === null || typeof judge.enabled !== 'boolean') {
      throw new Error(`Sabi config ${source}: judge.enabled must be a boolean`)
    }
    if (judge.enabled) {
      if (typeof judge.baseURL !== 'string' || !judge.baseURL) {
        throw new Error(`Sabi config ${source}: judge.baseURL is required when the judge is enabled`)
      }
      try {
        new URL(judge.baseURL)
      } catch {
        throw new Error(`Sabi config ${source}: judge.baseURL is not a valid URL`)
      }
      if (judge.model !== undefined && typeof judge.model !== 'string') {
        throw new Error(`Sabi config ${source}: judge.model must be a string`)
      }
      if (judge.callOn !== undefined) {
        if (!Array.isArray(judge.callOn) || judge.callOn.some((rule) => typeof rule !== 'string')) {
          throw new Error(`Sabi config ${source}: judge.callOn must be an array of policy rule names`)
        }
      }
      for (const [name, value] of Object.entries(judge.thresholds ?? {})) {
        if (typeof value !== 'number' || value < 0 || value > 1) {
          throw new Error(`Sabi config ${source}: judge.thresholds.${name} must be a number between 0 and 1`)
        }
      }
      for (const [name, value] of [
        ['timeoutMs', judge.timeoutMs],
        ['cacheTtlMs', judge.cacheTtlMs],
        ['maxStateChars', judge.maxStateChars],
        ['costPerMTokInput', judge.costPerMTokInput],
      ] as const) {
        if (value !== undefined && (typeof value !== 'number' || value <= 0)) {
          throw new Error(`Sabi config ${source}: judge.${name} must be a positive number`)
        }
      }
    }
  }

  const telemetry = config.telemetry
  if (telemetry !== undefined) {
    if (typeof telemetry !== 'object' || telemetry === null) {
      throw new Error(`Sabi config ${source}: telemetry must be an object`)
    }
    if (telemetry.allowlistOnly !== undefined && typeof telemetry.allowlistOnly !== 'boolean') {
      throw new Error(`Sabi config ${source}: telemetry.allowlistOnly must be a boolean`)
    }
    if (telemetry.captureSnippets !== undefined && typeof telemetry.captureSnippets !== 'boolean') {
      throw new Error(`Sabi config ${source}: telemetry.captureSnippets must be a boolean`)
    }
    if (telemetry.captureChars !== undefined && (typeof telemetry.captureChars !== 'number' || telemetry.captureChars <= 0)) {
      throw new Error(`Sabi config ${source}: telemetry.captureChars must be a positive number`)
    }
  }

  const harness = config.harness
  if (harness !== undefined) {
    if (typeof harness !== 'object' || harness === null) {
      throw new Error(`Sabi config ${source}: harness must be an object`)
    }
    if (!harness.tiers || typeof harness.tiers !== 'object' || Array.isArray(harness.tiers)) {
      throw new Error(`Sabi config ${source}: harness.tiers must be an object mapping tier names to models`)
    }
    for (const [tierName, tier] of Object.entries(harness.tiers)) {
      if (!tier || typeof tier !== 'object' || typeof tier.model !== 'string' || !tier.model) {
        throw new Error(`Sabi config ${source}: harness.tiers.${tierName} must declare a model id`)
      }
      if (tier.effort !== undefined && typeof tier.effort !== 'string') {
        throw new Error(`Sabi config ${source}: harness.tiers.${tierName}.effort must be a string`)
      }
      if (tier.minPlan !== undefined && typeof tier.minPlan !== 'string') {
        throw new Error(`Sabi config ${source}: harness.tiers.${tierName}.minPlan must be a string`)
      }
    }
  }

  return { ...config, upstreams, models, aliases, policy }
}

/** Tiers that could serve `target` (`auto` = every tier the policy can pick, in declaration order). */
export function tiersFor(config: SabiConfig, target: string): string[] {
  if (target !== 'auto') return [target]
  const policyTiers = Object.values(config.policy).filter((tier) => tier !== 'off' && config.models[tier])
  return policyTiers.length ? [...new Set(policyTiers)] : Object.keys(config.models)
}

const positive = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * Smallest declared context window across the tiers that could serve `target`. A client should
 * advertise a window Sabi can always honour, not the largest one. Undefined when no tier declares
 * one — the caller omits the limit rather than guessing.
 */
export function minContextWindowFor(config: SabiConfig, target: string): number | undefined {
  const windows = tiersFor(config, target).map((tier) => config.models[tier]?.contextWindow).filter(positive)
  return windows.length ? Math.min(...windows) : undefined
}

/** Smallest declared `maxOutputTokens` across those tiers, when an operator has declared any. */
export function minOutputTokensFor(config: SabiConfig, target: string): number | undefined {
  const limits = tiersFor(config, target).map((tier) => config.models[tier]?.maxOutputTokens).filter(positive)
  return limits.length ? Math.min(...limits) : undefined
}

export function resolveKey(reference: string | false | undefined): string | undefined {
  if (reference === false || reference === undefined) return undefined
  const trimmed = String(reference).trim()
  if (!trimmed) return undefined
  const match =
    trimmed.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/) ?? trimmed.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)
  if (!match) {
    throw new Error(`unsupported apiKey reference '${trimmed}' (use "$ENV_VAR" or false)`)
  }
  const name = match[1] ?? ''
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}
