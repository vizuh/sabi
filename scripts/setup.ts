#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultConfigPath, loadConfig, minContextWindowFor, promptWithTimeout, secretSearchPaths, validateConfig } from '@sabi/core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMMAND_CODE_CONNECT = path.join(ROOT, 'packages/adapters/command-code/src/connect.ts')
const OPENCODE_CONNECT = path.join(ROOT, 'packages/adapters/opencode/src/connect.ts')
const HERMES_PLUGIN_DIR = path.join(ROOT, 'packages/adapters/hermes/plugin')
const HERMES_CONFIG_EXAMPLE = path.join(ROOT, 'packages/adapters/hermes/config.yaml.example')

/** A flag present in argv wins outright and never touches stdin; otherwise prompt with a safe fallback. */
export async function resolveYesNo(
  argv: string[],
  isTTY: boolean,
  yesFlag: string,
  noFlag: string,
  question: string,
  fallback: boolean,
): Promise<boolean> {
  if (argv.includes(yesFlag)) return true
  if (argv.includes(noFlag)) return false
  if (!isTTY) return fallback
  const answer = await promptWithTimeout(question)
  if (answer === undefined) return fallback
  return answer === 'y' || answer === 'yes'
}

type Harness = 'command-code' | 'opencode' | 'hermes'

function flagValue(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

/** No safe default harness exists — every choice writes a different file. Non-interactive + no
 * flag returns undefined and lets the caller print usage; an unrecognized flag value is a hard
 * error (exit 1), never silently treated as "no flag given". */
export async function resolveHarness(argv: string[], isTTY: boolean): Promise<Harness | 'recipe-only' | undefined> {
  const flag = flagValue(argv, '--harness')
  if (flag !== undefined) {
    if (flag === 'command-code' || flag === 'opencode' || flag === 'hermes') return flag
    if (flag === 'kilo' || flag === 'prime-agent') return 'recipe-only'
    console.error(`Unrecognized --harness=${flag}. Use command-code, opencode, hermes, kilo, or prime-agent.`)
    process.exitCode = 1
    return undefined
  }
  if (!isTTY) return undefined
  const answer = await promptWithTimeout(
    'Which harness?\n  [1] Command Code\n  [2] OpenCode\n  [3] Hermes\n  [4] Kilo / Prime Agent (recipe only)\n> ',
  )
  if (answer === '1') return 'command-code'
  if (answer === '2') return 'opencode'
  if (answer === '3') return 'hermes'
  if (answer === '4') return 'recipe-only'
  return undefined
}

async function resolveClass(argv: string[], isTTY: boolean): Promise<'a' | 'b'> {
  const flag = flagValue(argv, '--class')
  if (flag === 'a' || flag === 'b') return flag
  if (!isTTY) return 'a'
  const answer = await promptWithTimeout('Command Code: [a] mod (free, no network) or [b] proxy (paid via upstream)? [a] ')
  return answer === 'b' ? 'b' : 'a'
}

/** Surfaces a spawned writer's failure as this process's own exit code — a caller chaining
 * `npm run setup && start-agent` must see a non-zero status when the writer actually failed. */
function checkSpawn(result: SpawnSyncReturns<Buffer | string>): void {
  if (result.error) {
    console.error(`Failed to run the writer: ${result.error.message}`)
    process.exitCode = 1
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1
  }
}

function runCommandCodeClassA(): void {
  console.log('Class A (mod) is registered per-project, not globally. Run this in the project you want Sabi active in:')
  console.log('')
  console.log(`  cmd mods add ${path.relative(process.cwd(), path.join(ROOT, 'packages/adapters/command-code'))}`)
  console.log('  cmd mods list   # confirm: sabi · project · from local:...')
  console.log('')
  console.log('No network, no key, no proxy — nothing written by this wizard.')
}

async function runCommandCodeClassB(argv: string[], isTTY: boolean): Promise<void> {
  const paid = await resolveYesNo(
    argv,
    isTTY,
    '--paid',
    '--free',
    'Route paid upstream models (real API credits) through Command Code? [y/N] ',
    false,
  )
  const extra = argv.includes('--include-local') ? ['--include-local'] : []
  checkSpawn(spawnSync(process.execPath, [COMMAND_CODE_CONNECT, paid ? '--paid' : '--free', ...extra], { stdio: 'inherit' }))
}

function runOpenCode(argv: string[]): void {
  const extra = [
    ...(argv.includes('--set-default') ? ['--set-default'] : []),
    ...(argv.includes('--include-local') ? ['--include-local'] : []),
  ]
  checkSpawn(spawnSync(process.execPath, [OPENCODE_CONNECT, ...extra], { stdio: 'inherit' }))
}

function runHermes(argv: string[]): void {
  // Validate the config exists and parses *before* any filesystem side effect below, so a
  // missing/invalid sabi.config.json fails cleanly instead of aborting mid-way through creating
  // HERMES_HOME with no indication that the plugin/config.yaml it just wrote are actually fine.
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
    return
  }

  const home = flagValue(argv, '--hermes-home') ?? path.join(process.cwd(), '.sabi', 'hermes-home')
  if (existsSync(home) && readdirSync(home).length > 0) {
    console.error(`Refusing to use ${home}: it exists and is not empty. Pass --hermes-home=<path> for a fresh one.`)
    process.exitCode = 1
    return
  }
  mkdirSync(path.join(home, 'plugins'), { recursive: true })
  cpSync(HERMES_PLUGIN_DIR, path.join(home, 'plugins', 'sabi-metadata'), {
    recursive: true,
    filter: (src) => !src.includes('__pycache__'),
  })
  copyFileSync(HERMES_CONFIG_EXAMPLE, path.join(home, 'config.yaml'))

  console.log(`Created ${home}`)
  console.log(`  plugin copied to ${path.join(home, 'plugins', 'sabi-metadata')}`)
  console.log('  config.yaml written from the template.')
  console.log('  REPLACE_WITH_VERIFIED_CONTEXT_TOKENS is left as a placeholder — not filled in automatically.')

  const suggested = minContextWindowFor(config, 'auto')
  if (suggested) {
    console.log(`  computed candidate (NOT operator-verified): ${suggested}`)
    console.log('  verify it against every backend you route to before pasting it into config.yaml.')
  }
  console.log('')
  console.log(`Next: HERMES_HOME=${home} hermes chat`)
  console.log('Then select sabi-code.')
  console.log('This path is uncertified — no real Hermes profile has been run against Sabi yet (docs/harnesses.md).')
}

function isInsideGitRepo(filePath: string): boolean {
  let dir = path.dirname(filePath)
  while (true) {
    if (existsSync(path.join(dir, '.git'))) return true
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/** Always sets judge.enabled to the resolved answer — declining must actively turn Jev off, not
 * leave whatever the config already had (the shipped sabi.config.json ships judge.enabled: true,
 * so a no-op here would silently ignore "no"). Never reads, prints, or writes the literal
 * TYPESAFE_API_KEY value — sabi.config.json's apiKey fields hold "$ENV_VAR" references only. */
export function setJevEnabled(configPath: string, enabled: boolean): void {
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const judge = (parsed.judge ?? {}) as Record<string, unknown>
  parsed.judge = {
    ...judge,
    enabled,
    baseURL: judge.baseURL ?? 'https://api.typesafe.ai/v1',
    apiKey: judge.apiKey ?? '$TYPESAFE_API_KEY',
  }
  validateConfig(parsed, configPath)
  const backupPath = `${configPath}.sabi-backup`
  if (!existsSync(backupPath)) copyFileSync(configPath, backupPath)
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`)
}

function reportJev(configPath: string, enabled: boolean): void {
  console.log(`Updated ${configPath}: judge.enabled = ${enabled}`)
  if (isInsideGitRepo(configPath)) console.log('This file is git-tracked — review the diff before committing.')
  if (enabled && !process.env.TYPESAFE_API_KEY) {
    if (secretSearchPaths().some((candidate) => existsSync(candidate))) {
      console.log('TYPESAFE_API_KEY is not in this shell; Sabi will check the discovered secrets file when it starts.')
    } else {
      console.log('TYPESAFE_API_KEY is not set in this shell or a discovered secrets file. Export it or set SABI_SECRETS_FILE before starting Sabi.')
    }
  }
}

function printUsage(): void {
  console.log('Usage: npm run setup -- --harness=command-code|opencode|hermes [--class=a|b] [--jev|--no-jev] [--paid|--free]')
  console.log('No harness flag and no TTY to prompt on — nothing written. Pick one explicitly.')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const isTTY = Boolean(process.stdin.isTTY)

  const harness = await resolveHarness(argv, isTTY)
  if (!harness) {
    if (process.exitCode !== 1) printUsage()
    return
  }
  if (harness === 'recipe-only') {
    console.log('Kilo and Prime Agent are recipe-only today — see docs/harnesses.md.')
    return
  }

  // Jev is proxy-only (Class B / OpenCode / Hermes) — the Command Code mod never calls it, so
  // asking (and patching sabi.config.json) for Class A would contradict its own "nothing written
  // by this wizard" message. Resolve the class first to know whether the question is relevant.
  const commandCodeClass = harness === 'command-code' ? await resolveClass(argv, isTTY) : undefined
  const jevRelevant = harness !== 'command-code' || commandCodeClass === 'b'

  if (jevRelevant) {
    const wantJev = await resolveYesNo(
      argv,
      isTTY,
      '--jev',
      '--no-jev',
      'Enable Jev (the TypeSafe judgment layer, needs a TypeSafe key)? [y/N] ',
      false,
    )
    let configPath: string
    try {
      configPath = defaultConfigPath()
      loadConfig(configPath) // throws a friendly "not found" error before any write is attempted
    } catch (error) {
      console.error((error as Error).message)
      process.exitCode = 1
      return
    }
    setJevEnabled(configPath, wantJev)
    reportJev(configPath, wantJev)
  } else {
    console.log('Jev is proxy-only and unavailable on the Command Code mod (Class A) — skipping.')
  }

  if (harness === 'command-code') {
    if (commandCodeClass === 'a') runCommandCodeClassA()
    else await runCommandCodeClassB(argv, isTTY)
  } else if (harness === 'opencode') runOpenCode(argv)
  else runHermes(argv)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
