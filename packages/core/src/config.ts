import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SabiConfig } from './types.ts'

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export function defaultConfigPath(): string {
  return process.env.SABI_CONFIG ?? path.join(REPO_ROOT, 'sabi.config.json')
}

export function loadConfig(configPath = defaultConfigPath()): SabiConfig {
  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    throw new Error(`Sabi config not found at ${configPath} (set SABI_CONFIG to override)`)
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
