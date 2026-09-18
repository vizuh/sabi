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

export function validateConfig(value: unknown, source = '<inline>'): SabiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Sabi config ${source}: expected a JSON object`)
  }
  const config = value as SabiConfig
  const upstreams = config.upstreams ?? {}
  const models = config.models ?? {}
  const aliases = config.aliases ?? {}
  const policy = config.policy ?? {}

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
    if (!model || typeof model.model !== 'string' || !model.model) {
      throw new Error(`Sabi config ${source}: model tier '${name}' has no model id`)
    }
    if (!model.upstream || !upstreams[model.upstream]) {
      throw new Error(`Sabi config ${source}: model tier '${name}' references unknown upstream '${model.upstream}'`)
    }
  }

  if (!Object.keys(aliases).length) throw new Error(`Sabi config ${source}: no aliases declared`)
  for (const [alias, target] of Object.entries(aliases)) {
    if (target !== 'auto' && !models[target]) {
      throw new Error(`Sabi config ${source}: alias '${alias}' targets unknown tier '${target}'`)
    }
  }

  for (const [condition, tier] of Object.entries(policy)) {
    if (tier !== 'off' && !models[tier]) {
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
