#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEnabledUpstream, loadConfig, promptWithTimeout, tiersFor, type SabiConfig, type UpstreamEntry } from '@sabi/core'

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

/** Keyless is this repo's existing signal for "no external billing" (e.g. local Ollama today). */
export function isFreeUpstream(upstream: UpstreamEntry | undefined): boolean {
  return upstream?.apiKey === false
}

/**
 * Smallest declared context window across `tiers` only — deliberately narrower than core's
 * `minContextWindowFor`, which windows every tier `target` could reach regardless of consent.
 * Here `tiers` is already the paid/free-filtered usable set, so the advertised window matches
 * what actually gets registered, not what the alias could reach with different consent.
 */
export function minContextWindow(config: SabiConfig, tiers: string[]): number | undefined {
  const windows = tiers
    .map((tier) => config.models[tier]?.contextWindow)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  return windows.length ? Math.min(...windows) : undefined
}

/** --paid/--free win outright; otherwise prompt only on a real TTY, default to free when non-interactive. */
export function resolveConsent(argv: string[], isTTY: boolean): 'paid' | 'free' | 'prompt' {
  if (argv.includes('--paid')) return 'paid'
  if (argv.includes('--free')) return 'free'
  return isTTY ? 'prompt' : 'free'
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

async function resolveAllowPaid(): Promise<boolean> {
  const consent = resolveConsent(process.argv, Boolean(process.stdin.isTTY))
  if (consent === 'paid') return true
  if (consent === 'free') {
    if (!process.argv.includes('--free')) {
      console.log('No TTY and no --paid/--free flag: skipping paid upstreams by default. Re-run with --paid to include them.')
    }
    return false
  }
  const answer = await promptWithTimeout('Route paid upstream models (real API credits) through Command Code? [y/N] ')
  if (answer === undefined) {
    console.log('No answer within the prompt timeout: defaulting to no paid upstreams.')
    return false
  }
  return answer === 'y' || answer === 'yes'
}

async function main(): Promise<void> {
  const config = loadConfig()
  const file = readProviders()
  const provider = (file.provider ?? {}) as Record<string, unknown>
  const allowPaid = await resolveAllowPaid()

  const models: Record<string, { name: string; contextWindow?: number }> = {}
  const skippedKeyless: string[] = []
  for (const [alias, target] of Object.entries(config.aliases)) {
    const tiers = tiersFor(config, target)
    const usable = tiers.filter((tier) => {
      const upstream = config.upstreams[config.models[tier]?.upstream ?? '']
      return isEnabledUpstream(upstream) && (allowPaid || isFreeUpstream(upstream))
    })
    if (!usable.length) continue
    // "Local" here means every usable tier is keyless (today: only Ollama), not specifically
    // Ollama — --include-local gates whichever keyless upstream this is.
    const keylessOnly = usable.every((tier) => isFreeUpstream(config.upstreams[config.models[tier]!.upstream]))
    if (keylessOnly && !includeLocal) {
      skippedKeyless.push(alias)
      continue
    }
    const entry: { name: string; contextWindow?: number } = { name: displayNames[alias] ?? alias }
    const contextWindow = minContextWindow(config, usable)
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
  if (!Object.keys(models).length) {
    console.log('  No proxy-backed models registered (paid upstreams skipped, no eligible free/local models).')
    console.log('  Use the Class A mod for cost-free routing instead — see docs/install.md#a--command-code-mod.')
    console.log('  Re-run with --paid to include paid upstreams, or --include-local for the local Ollama tier.')
  } else if (skippedKeyless.length) {
    console.log(`  ${skippedKeyless.join(', ')} skipped (keyless upstream) — rerun with --include-local to expose ${skippedKeyless.length > 1 ? 'them' : 'it'}`)
  }
  console.log(`  existing providers preserved: ${subjects.filter((id) => id !== 'sabi').join(', ') || '(none)'}`)
  console.log('')
  console.log('Next: start Sabi (npm start), then in Command Code run /model — "Sabi" appears as a provider.')
  console.log('Verify headlessly with: cmd --list-models | grep sabi')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
