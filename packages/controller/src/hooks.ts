import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  controllerStateDir,
  hasControllerPreferences,
  requestControllerDaemon,
  startControllerDaemon,
} from './daemon.ts'

export type HookHarness = 'claude' | 'codex'
export type InstalledHook = 'claude' | 'codex' | 'opencode'

export interface HookInstallResult {
  harness: InstalledHook
  path: string
  backup?: string
  plugin?: string
}

type JsonObject = Record<string, unknown>

const HOOK_TIMEOUT_SECONDS = 10

function objectValue(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`)
  return value as JsonObject
}

function readObject(file: string, initial: JsonObject): JsonObject {
  if (!existsSync(file)) return initial
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Refusing to touch ${file}: invalid JSON (${(error as Error).message})`)
  }
  return objectValue(parsed, file)
}

function writeObject(file: string, value: JsonObject): string | undefined {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const backup = `${file}.sabi-backup`
  if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  return existsSync(backup) ? backup : undefined
}

function commandFor(env: NodeJS.ProcessEnv, harness: HookHarness): string {
  const configured = env.SABI_HOOK_COMMAND?.trim()
  const quote = (value: string): string => process.platform === 'win32'
    ? `"${value.replaceAll('"', '\\"')}"`
    : `'${value.replaceAll("'", "'\\''")}'`
  const executable = configured || (process.argv[1] ? `${quote(process.execPath)} ${quote(path.resolve(process.argv[1]))}` : 'sabi')
  return `${executable} hook ${harness}`
}

function hookEntry(env: NodeJS.ProcessEnv, harness: HookHarness, event: string, matcher?: string): JsonObject {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'command',
      command: `${commandFor(env, harness)} --event=${event}`,
      timeout: HOOK_TIMEOUT_SECONDS,
      statusMessage: `Sabi ${harness} routing`,
    }],
  }
}

function appendEvent(container: JsonObject, event: string, entry: JsonObject, label: string, harness: HookHarness): void {
  const current = container[event]
  if (current !== undefined && !Array.isArray(current)) throw new Error(`${label}.${event} must be an array`)
  const entries = (current as unknown[] | undefined) ?? []
  if (entries.some((item) => JSON.stringify(item).includes(`hook ${harness}`))) return
  container[event] = [...entries, entry]
}

function claudeSettingsPath(env: NodeJS.ProcessEnv): string {
  return env.SABI_CLAUDE_SETTINGS?.trim() || path.join(env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude'), 'settings.json')
}

function codexHooksPath(env: NodeJS.ProcessEnv): string {
  return env.SABI_CODEX_HOOKS?.trim() || path.join(env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'), 'hooks.json')
}

function openCodeConfigPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.SABI_OPENCODE_CONFIG?.trim() || env.OPENCODE_CONFIG?.trim()
  if (explicit) return explicit
  const directory = env.OPENCODE_CONFIG_DIR?.trim() || env.ORCA_OPENCODE_CONFIG_DIR?.trim()
  return path.join(directory || path.join(os.homedir(), '.config', 'opencode'), 'opencode.json')
}

function openCodeSourcePath(env: NodeJS.ProcessEnv): string {
  if (env.SABI_OPENCODE_HOOK_SOURCE?.trim()) return env.SABI_OPENCODE_HOOK_SOURCE.trim()
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  for (const bundled of [
    path.resolve(moduleDir, '../resources/opencode/sabi-hook.mjs'),
    path.resolve(moduleDir, 'resources/opencode/sabi-hook.mjs'),
  ]) {
    if (existsSync(bundled)) return bundled
  }
  return path.resolve(moduleDir, '../../adapters/opencode/src/sabi-hook.mjs')
}

function installClaude(env: NodeJS.ProcessEnv): HookInstallResult {
  const file = claudeSettingsPath(env)
  const settings = readObject(file, {})
  const hooks = objectValue(settings.hooks ?? {}, `${file}.hooks`)
  appendEvent(hooks, 'UserPromptSubmit', hookEntry(env, 'claude', 'UserPromptSubmit', '*'), `${file}.hooks`, 'claude')
  settings.hooks = hooks
  return { harness: 'claude', path: file, backup: writeObject(file, settings) }
}

function installCodex(env: NodeJS.ProcessEnv): HookInstallResult {
  const file = codexHooksPath(env)
  const settings = readObject(file, {})
  const hooks = objectValue(settings.hooks ?? {}, `${file}.hooks`)
  appendEvent(hooks, 'SessionStart', hookEntry(env, 'codex', 'SessionStart', 'startup|resume|clear|compact'), `${file}.hooks`, 'codex')
  appendEvent(hooks, 'UserPromptSubmit', hookEntry(env, 'codex', 'UserPromptSubmit'), `${file}.hooks`, 'codex')
  appendEvent(hooks, 'SessionEnd', hookEntry(env, 'codex', 'SessionEnd'), `${file}.hooks`, 'codex')
  settings.hooks = hooks
  return { harness: 'codex', path: file, backup: writeObject(file, settings) }
}

function installOpenCode(env: NodeJS.ProcessEnv, stateDir: string): HookInstallResult {
  const source = openCodeSourcePath(env)
  if (!existsSync(source)) throw new Error(`OpenCode hook source not found: ${source}`)
  const plugin = path.join(stateDir, 'hooks', 'opencode.mjs')
  mkdirSync(path.dirname(plugin), { recursive: true, mode: 0o700 })
  copyFileSync(source, plugin)
  const file = openCodeConfigPath(env)
  const config = readObject(file, { $schema: 'https://opencode.ai/config.json' })
  const current = config.plugin
  if (current !== undefined && !Array.isArray(current)) throw new Error(`${file}.plugin must be an array`)
  const plugins = (current as unknown[] | undefined) ?? []
  config.plugin = plugins.includes(plugin) ? plugins : [...plugins, plugin]
  return { harness: 'opencode', path: file, plugin, backup: writeObject(file, config) }
}

export function installHooks(options: { harnesses?: InstalledHook[]; stateDir?: string; env?: NodeJS.ProcessEnv } = {}): HookInstallResult[] {
  const env = options.env ?? process.env
  const stateDir = options.stateDir ?? controllerStateDir(env)
  const harnesses = options.harnesses ?? ['claude', 'codex', 'opencode']
  return harnesses.map((harness) => {
    if (harness === 'claude') return installClaude(env)
    if (harness === 'codex') return installCodex(env)
    return installOpenCode(env, stateDir)
  })
}

export interface RestoredHookResult {
  harness: InstalledHook
  path: string
  restored: boolean
}

export function restoreHookBackups(options: { harnesses?: InstalledHook[]; env?: NodeJS.ProcessEnv } = {}): RestoredHookResult[] {
  const env = options.env ?? process.env
  const harnesses = options.harnesses ?? ['claude', 'codex', 'opencode']
  const paths: Record<InstalledHook, string> = {
    claude: claudeSettingsPath(env),
    codex: codexHooksPath(env),
    opencode: openCodeConfigPath(env),
  }
  return harnesses.map((harness) => {
    const file = paths[harness]
    const backup = `${file}.sabi-backup`
    if (!existsSync(backup)) return { harness, path: file, restored: false }
    if (!existsSync(file)) {
      copyFileSync(backup, file)
      return { harness, path: file, restored: true }
    }
    try {
      const current = readObject(file, {})
      let changed = false
      if (harness === 'opencode') {
        const plugins = current.plugin
        if (Array.isArray(plugins)) {
          const installed = path.resolve(controllerStateDir(env), 'hooks', 'opencode.mjs')
          const filtered = plugins.filter((plugin) => plugin !== installed)
          changed = filtered.length !== plugins.length
          if (changed) current.plugin = filtered
        }
      } else {
        const hooks = current.hooks
        if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
          for (const [event, entries] of Object.entries(hooks as JsonObject)) {
            if (!Array.isArray(entries)) continue
            const filtered = entries.filter((entry) => !JSON.stringify(entry).includes(`hook ${harness}`))
            if (filtered.length !== entries.length) {
              changed = true
              if (filtered.length) (hooks as JsonObject)[event] = filtered
              else delete (hooks as JsonObject)[event]
            }
          }
        }
      }
      if (changed) writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
      return { harness, path: file, restored: changed }
    } catch {
      return { harness, path: file, restored: false }
    }
  })
}

function recordTarget(record: unknown): JsonObject | undefined {
  return objectValue(record, 'controller record').target as JsonObject | undefined
}

function hookTargetOverride(action: string, target: JsonObject | undefined): JsonObject | undefined {
  if (!target) return undefined
  if (action === 'DELEGATE' && typeof target.id === 'string') return { sessionId: target.id }
  if (action === 'SPAWN' && typeof target.agent === 'string') return { harness: target.agent }
  return undefined
}

function executionAccepted(record: JsonObject): boolean {
  const execution = objectValue(record.execution ?? {}, 'controller execution')
  return execution.status === 'started' || execution.status === 'completed' || execution.status === 'rerouted'
}

function delegationMessage(record: JsonObject): string {
  const target = objectValue(record.target ?? {}, 'controller target')
  const agent = typeof target.agent === 'string' ? target.agent : 'selected agent'
  const action = typeof record.action === 'string' ? record.action : 'delegated'
  const verb = action === 'DELEGATE' ? 'delegated' : action === 'SPAWN' ? 'started' : action.toLowerCase()
  return `Sabi ${verb} this request to ${agent}; it was not executed in the current session.`
}

export function hookOutput(harness: HookHarness, event: string, record?: JsonObject): JsonObject {
  if (!record || !executionAccepted(record)) return {}
  const message = delegationMessage(record)
  if (harness === 'codex') {
    return {
      continue: false,
      stopReason: message,
      systemMessage: message,
      hookSpecificOutput: { hookEventName: event, additionalContext: message },
    }
  }
  return { continue: false, stopReason: message, systemMessage: message }
}

function promptFrom(input: JsonObject): string | undefined {
  for (const key of ['prompt', 'user_prompt', 'userPrompt']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim()
  }
  return undefined
}

function sessionIdFrom(input: JsonObject): string | undefined {
  for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim()
  }
  return undefined
}

export async function routeHookPrompt(
  harness: HookHarness,
  event: string,
  input: JsonObject,
  env: NodeJS.ProcessEnv = process.env,
): Promise<JsonObject> {
  const request = promptFrom(input)
  const stateDir = controllerStateDir(env)
  if (!hasControllerPreferences(stateDir)) return {}
  try {
    const info = await startControllerDaemon({ stateDir })
    const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? path.resolve(input.cwd) : process.cwd()
    const sessionId = sessionIdFrom(input)
    if (sessionId) {
      await requestControllerDaemon('/v1/sessions/register', {
        info,
        method: 'POST',
        body: { sessionId, adapter: harness, harness, worktree: cwd, lifecycle: event === 'SessionEnd' ? 'dead' : 'active' },
      })
    }
    if (!request || event !== 'UserPromptSubmit') return {}
    const plan = await requestControllerDaemon('/plan', {
      info,
      method: 'POST',
      body: { request, cwd, waitMs: 5000 },
    })
    if (!plan || !['DELEGATE', 'SPAWN', 'ORCHESTRATE'].includes(String(plan.action))) return {}
    const action = String(plan.action)
    const override = hookTargetOverride(action, recordTarget(plan))
    const target = recordTarget(plan)
    if (action !== 'ORCHESTRATE' && !override) return {}
    const result = await requestControllerDaemon('/route', {
      info,
      method: 'POST',
      body: {
        request,
        cwd,
        orchestrate: action === 'ORCHESTRATE',
        ...(override ? { override } : {}),
        waitMs: 5000,
      },
    })
    return hookOutput(harness, event, result ?? undefined)
  } catch {
    // A hook must never make the host unusable because Sabi is stopped or unavailable.
    return {}
  }
}

export async function runHookCommand(harness: HookHarness, event = 'UserPromptSubmit'): Promise<void> {
  let input = ''
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      if (input.length <= 1_048_576) input += chunk
      if (input.length > 1_048_576) finish()
    })
    process.stdin.once('end', finish)
    process.stdin.once('error', finish)
    setTimeout(finish, 1000).unref()
  })
  try {
    const parsed = input.trim() ? objectValue(JSON.parse(input.replace(/^\uFEFF/, '')), 'hook input') : {}
    console.log(JSON.stringify(await routeHookPrompt(harness, event, parsed)))
  } catch {
    console.log('{}')
  }
}
