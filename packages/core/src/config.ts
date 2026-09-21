import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { POLICY_ORDER } from './policy.ts'
import type { SabiConfig } from './types.ts'

const CONFIG_FILE = 'sabi.config.json'
const SECRET_FILE = '.env'
const SECRET_DIR = 'secrets'
const ENV_REFERENCE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/
const BRACED_ENV_REFERENCE = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/

/** `packages/core` in the repo, or the package root when installed under node_modules. */
export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))

export interface ConfigSearchOptions {
  cwd?: string
  packageRoot?: string
  env?: NodeJS.ProcessEnv
}

export interface SecretSearchOptions {
  cwd?: string
  packageRoot?: string
  env?: NodeJS.ProcessEnv
}

export interface SecretLoadOptions extends SecretSearchOptions {
  /** Explicit path used by tests and by users who keep secrets outside a workspace. */
  file?: string
  /**
   * Whether to install loaded values into the target environment. An explicitly passed
   * `env` object is always the installation target unless `install: false`; the live
   * `process.env` is only touched when `install: true` is passed explicitly, so a caller
   * that only checks credentials never mutates global state by accident.
   */
  install?: boolean
}

export interface SecretLoadResult {
  file?: string
  loaded: string[]
  error?: string
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
 * Bounded ancestor climb for `secrets/.env`: the workspace root is the containing `.git`
 * boundary (checked, then stop — never climb above the repo that owns the start dir), with
 * a hard ancestor cap as the backstop for directories outside any repo. The per-user Sabi
 * directory remains the fallback for the intended out-of-workspace case.
 */
export const MAX_SECRET_SEARCH_DEPTH = 8

function nearestSecretFile(start: string): string | undefined {
  let dir = path.resolve(start)
  for (let depth = 0; depth <= MAX_SECRET_SEARCH_DEPTH; depth++) {
    const candidate = path.join(dir, SECRET_DIR, SECRET_FILE)
    if (existsSync(candidate)) return candidate
    if (existsSync(path.join(dir, '.git'))) return undefined
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
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

/**
 * Secret discovery is optional and provider-neutral: an explicit file wins, then a workspace
 * `secrets/.env` (bounded climb: at most MAX_SECRET_SEARCH_DEPTH ancestors, never above the
 * containing `.git`), then the per-user Sabi directory. Existing process variables always win.
 */
export function secretSearchPaths(options: SecretSearchOptions = {}): string[] {
  const env = options.env ?? process.env
  const explicit = env.SABI_SECRETS_FILE?.trim()
  if (explicit) return [explicit]

  const candidates: string[] = []
  for (const start of [options.cwd ?? process.cwd(), options.packageRoot ?? PACKAGE_ROOT]) {
    const candidate = nearestSecretFile(start)
    if (candidate) candidates.push(candidate)
  }
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  candidates.push(
    path.join(configHome, 'sabi', 'secrets.env'),
    path.join(configHome, 'sabi', SECRET_FILE),
  )
  return [...new Set(candidates)]
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
      // An empty modality list turns the tier into a target that refuses every round that
      // declares a modality; empty capability arrays are rejected for the modality fields.
      if ((field === 'inputModalities' || field === 'outputModalities') && (items as string[]).length === 0) {
        fail(`capabilities.${field}`, 'must not be empty')
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
    if (upstream.enabled !== undefined && typeof upstream.enabled !== 'boolean') {
      throw new Error(`Sabi config ${source}: upstream '${name}'.enabled must be a boolean`)
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

  const knownRules = new Set<string>(POLICY_ORDER)
  for (const [condition, tier] of Object.entries(policy)) {
    if (!knownRules.has(condition)) {
      throw new Error(`Sabi config ${source}: policy rule '${condition}' is not a known rule (${POLICY_ORDER.join(', ')})`)
    }
    if (typeof tier !== 'string' || (tier !== 'off' && !Object.hasOwn(models, tier))) {
      throw new Error(`Sabi config ${source}: policy rule '${condition}' targets unknown tier '${tier}'`)
    }
  }
  // The router falls back to `policy.unclassified`, then to a literal 'cheap'. A config whose
  // tiers are not literally called `cheap` would otherwise 500 on the first unmatched round,
  // so when an adaptive (`auto`) alias exists the effective fallback must resolve to a
  // declared tier at load time. Fixed-alias-only configs (no `auto`) never take this path.
  if (Object.values(aliases).includes('auto')) {
    const fallbackTier = typeof policy.unclassified === 'string' && policy.unclassified !== 'off'
      ? policy.unclassified
      : 'cheap'
    if (!Object.hasOwn(models, fallbackTier)) {
      throw new Error(`Sabi config ${source}: policy.unclassified must resolve to a declared tier (got '${String(policy.unclassified)}')`)
    }
  }

  const transportFallback = config.transportFallback
  if (transportFallback !== undefined) {
    if (!isObject(transportFallback)) {
      throw new Error(`Sabi config ${source}: transportFallback must be an object`)
    }
    if (transportFallback.enabled !== undefined && typeof transportFallback.enabled !== 'boolean') {
      throw new Error(`Sabi config ${source}: transportFallback.enabled must be a boolean`)
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
        for (const rule of judge.callOn) {
          if (!knownRules.has(rule)) {
            throw new Error(`Sabi config ${source}: judge.callOn rule '${rule}' is not a known rule (${POLICY_ORDER.join(', ')})`)
          }
        }
      }
      if (judge.includeSnippets !== undefined && typeof judge.includeSnippets !== 'boolean') {
        throw new Error(`Sabi config ${source}: judge.includeSnippets must be a boolean`)
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

  const controller = config.controller
  if (controller !== undefined) {
    if (!isObject(controller)) throw new Error(`Sabi config ${source}: controller must be an object`)
    const controllerFields = new Set(['preferredHarnesses', 'harnesses'])
    for (const field of Object.keys(controller)) {
      if (!controllerFields.has(field)) throw new Error(`Sabi config ${source}: controller.${field} is not a supported field`)
    }
    const validateStrings = (value: unknown, label: string): void => {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error(`Sabi config ${source}: ${label} must be an array of nonempty strings`)
      }
      if (new Set(value).size !== value.length) throw new Error(`Sabi config ${source}: ${label} must not contain duplicates`)
    }
    if (controller.preferredHarnesses !== undefined) validateStrings(controller.preferredHarnesses, 'controller.preferredHarnesses')
    if (controller.harnesses !== undefined) {
      if (!isObject(controller.harnesses)) throw new Error(`Sabi config ${source}: controller.harnesses must be an object`)
      for (const [harnessName, settings] of Object.entries(controller.harnesses)) {
        if (!isObject(settings)) throw new Error(`Sabi config ${source}: controller.harnesses.${harnessName} must be an object`)
        for (const field of Object.keys(settings)) {
          if (field !== 'preferredModels') throw new Error(`Sabi config ${source}: controller.harnesses.${harnessName}.${field} is not a supported field`)
        }
        if (settings.preferredModels !== undefined) validateStrings(settings.preferredModels, `controller.harnesses.${harnessName}.preferredModels`)
      }
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
      if (tier.inputModalities !== undefined) {
        if (!Array.isArray(tier.inputModalities) ||
            tier.inputModalities.length === 0 ||
            tier.inputModalities.some((modality) => typeof modality !== 'string' || !MODALITIES.includes(modality))) {
          throw new Error(`Sabi config ${source}: harness.tiers.${tierName}.inputModalities must be a nonempty array of: ${MODALITIES.join(', ')}`)
        }
        if (new Set(tier.inputModalities).size !== tier.inputModalities.length) {
          throw new Error(`Sabi config ${source}: harness.tiers.${tierName}.inputModalities must not contain duplicates`)
        }
      }
      if (tier.contextWindow !== undefined &&
          (typeof tier.contextWindow !== 'number' || !Number.isSafeInteger(tier.contextWindow) || tier.contextWindow < 1)) {
        throw new Error(`Sabi config ${source}: harness.tiers.${tierName}.contextWindow must be a safe integer >= 1`)
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

export function keyReferenceName(reference: string | false | undefined): string | undefined {
  if (reference === false || reference === undefined) return undefined
  const trimmed = String(reference).trim()
  if (!trimmed) return undefined
  const match = trimmed.match(ENV_REFERENCE) ?? trimmed.match(BRACED_ENV_REFERENCE)
  if (!match) {
    throw new Error(`unsupported apiKey reference '${trimmed}' (use "$ENV_VAR" or false)`)
  }
  return match[1] ?? ''
}

export function resolveKey(reference: string | false | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = keyReferenceName(reference)
  if (!name) return undefined
  const value = env[name]
  return value && value.length > 0 ? value : undefined
}

/** Parse the small dotenv subset Sabi needs without evaluating the file as shell code. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    line = line.replace(/^export\s+/, '')
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2]?.trim() ?? ''
    if (!value.startsWith('"') && !value.startsWith("'")) value = value.replace(/\s+#.*$/, '').trim()
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      if (value[0] === '"') {
        try {
          value = JSON.parse(value) as string
        } catch {
          value = value.slice(1, -1)
        }
      } else {
        value = value.slice(1, -1)
      }
    }
    values[match[1] as string] = value
  }
  return values
}

function secretNamesFor(name: string): string[] {
  const names = [name, name.toLowerCase()]
  const provider = name.replace(/_API_KEY$/, '').replace(/_KEY$/, '')
  if (provider && provider !== name) {
    names.push(provider.toLowerCase(), `${provider.toLowerCase()}_api_key`)
  }
  return [...new Set(names)]
}

function configuredKeyNames(config: SabiConfig): string[] {
  const references = [
    ...Object.values(config.upstreams).filter((upstream) => upstream.enabled !== false).map((upstream) => upstream.apiKey),
    ...(config.judge?.enabled ? [config.judge.apiKey] : []),
  ]
  const names: string[] = []
  for (const reference of references) {
    try {
      const name = keyReferenceName(reference)
      if (name && !names.includes(name)) names.push(name)
    } catch {
      // Keep the existing unsupported-reference diagnostic in the startup credential check.
    }
  }
  return names
}

/**
 * Load only configured credential references; never copy unrelated workspace secrets into env.
 * Existing variables always win and are never overwritten. Values are reported by name only —
 * never printed or stored — and are installed into the target environment only when the caller
 * opts in: an explicitly passed `env` object is the target unless `install: false`, while the
 * live `process.env` requires `install: true`. A dry run (no install) still reports which
 * configured keys the file could satisfy, so credential checks need no global side effect.
 */
export function loadConfiguredSecrets(config: SabiConfig, options: SecretLoadOptions = {}): SecretLoadResult {
  const readEnv = options.env ?? process.env
  const shouldInstall = options.env !== undefined ? options.install !== false : options.install === true
  const target = options.env ?? process.env
  const names = configuredKeyNames(config)
  if (!names.length) return { loaded: [] }

  const file = (options.file?.trim() || secretSearchPaths(options).find((candidate) => existsSync(candidate)))
  if (!file) return { loaded: [] }

  let values: Record<string, string>
  try {
    values = parseEnvFile(readFileSync(file, 'utf8'))
  } catch (error) {
    return { file, loaded: [], error: `could not read ${file}: ${(error as Error).message}` }
  }

  const loaded: string[] = []
  for (const name of names) {
    if (readEnv[name]) continue
    const value = secretNamesFor(name).map((candidate) => values[candidate]).find((candidate) => candidate)
    if (value) {
      if (shouldInstall) target[name] = value
      loaded.push(name)
    }
  }
  return { file, loaded }
}
