import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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
  // Created once and never refreshed: the rollback target stays anchored to the
  // pre-first-setup content. It is removed when uninstall succeeds (see
  // restoreHookBackups), so a later uninstall cannot resurrect a deleted file.
  if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  return existsSync(backup) ? backup : undefined
}

/**
 * Validate an executable-plus-arguments hook command. The value is written
 * into host configuration that the harness runs through a shell, so shell
 * metacharacters are rejected rather than quoted: quoting the whole value
 * would break the supported `executable + arguments` shape (e.g.
 * `node /path/to/sabi.mjs`). The error never echoes the value itself.
 */
export function validateHookCommand(value: string): void {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('invalid SABI_HOOK_COMMAND: value must be an executable path plus optional arguments')
  const tokens = splitHookCommand(trimmed)
  if (!tokens.length) throw new Error('invalid SABI_HOOK_COMMAND: value must be an executable path plus optional arguments')
  const forbidden = process.platform === 'win32'
    ? /[;|&$`'"\n\r\0()<>*?!~#%^\[\]{}]/
    : /[;|&$`\\'"\n\r\0()<>*?!~#%^\[\]{}]/
  for (const token of tokens) {
    if (!token || forbidden.test(token)) {
      throw new Error('invalid SABI_HOOK_COMMAND: shell metacharacters are not allowed (use an executable path plus arguments)')
    }
  }
}

function splitHookCommand(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined
  let hasToken = false
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      hasToken = true
      continue
    }
    if (char === ' ' || char === '\t') {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += char
    hasToken = true
  }
  if (quote) throw new Error('invalid SABI_HOOK_COMMAND: unterminated quote (use an executable path plus arguments)')
  if (hasToken) tokens.push(current)
  return tokens
}

function commandFor(env: NodeJS.ProcessEnv, harness: HookHarness): string {
  const configured = env.SABI_HOOK_COMMAND?.trim()
  if (configured) validateHookCommand(configured)
  const quote = (value: string): string => process.platform === 'win32'
    ? `"${value.replaceAll('"', '\\"')}"`
    : `'${value.replaceAll("'", "'\\''")}'`
  // Already validated metacharacter-free above (as executable + optional arguments) — quoting
  // it here would collapse a legitimate multi-token value (e.g. `node /path/to/sabi.mjs`) into
  // one argument and break it.
  const executable = configured
    ?? (process.argv[1] ? `${quote(process.execPath)} ${quote(path.resolve(process.argv[1]))}` : 'sabi')
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

function isSabiHookEntry(value: unknown, harness: HookHarness): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as JsonObject
  if (!Array.isArray(entry.hooks)) return false
  return entry.hooks.some((hook) => {
    if (hook === null || typeof hook !== 'object' || Array.isArray(hook)) return false
    const value = hook as JsonObject
    const command = value.command
    return value.statusMessage === `Sabi ${harness} routing` && typeof command === 'string' && new RegExp(`(?:^|\\s)hook ${harness}(?:\\s|$)`).test(command)
  })
}

function appendEvent(container: JsonObject, event: string, entry: JsonObject, label: string, harness: HookHarness): void {
  const current = container[event]
  if (current !== undefined && !Array.isArray(current)) throw new Error(`${label}.${event} must be an array`)
  const entries = (current as unknown[] | undefined) ?? []
  if (entries.some((item) => isSabiHookEntry(item, harness))) return
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

function isEphemeralPath(target: string, tmpRoot: string = os.tmpdir()): boolean {
  try {
    const resolved = path.resolve(target)
    const root = path.resolve(tmpRoot)
    return resolved === root || resolved.startsWith(root + path.sep)
  } catch {
    return false
  }
}

/**
 * Structural match for Sabi's own OpenCode plugin entries (`.../hooks/opencode.mjs`).
 * Deliberately not an exact-path match: entries left by older or ephemeral state
 * homes (test temp dirs) must still be recognizable for pruning and health checks.
 */
function isSabiOpenCodePluginEntry(entry: unknown): entry is string {
  return typeof entry === 'string' && /(?:^|[/\\])hooks[/\\]opencode\.mjs$/.test(entry)
}

/**
 * Sabi plugin entries that must never persist in an OpenCode config: paths under
 * the OS temp dir (ephemeral test/controller homes) and entries whose plugin file
 * no longer exists. Unrelated user plugins are never touched.
 */
function isStaleSabiPluginEntry(entry: unknown): boolean {
  return isSabiOpenCodePluginEntry(entry) && (isEphemeralPath(entry) || !existsSync(entry))
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
  const file = openCodeConfigPath(env)
  // An ephemeral state home (a test temp dir) must never be registered in a real
  // OpenCode config: the entry dies with the temp dir and every later OpenCode
  // start fails to load it. Refuse before touching the filesystem; test runs must
  // point SABI_OPENCODE_CONFIG/OPENCODE_CONFIG_DIR at a temporary config too.
  if (isEphemeralPath(plugin) && !isEphemeralPath(file)) {
    throw new Error(
      `Refusing to register the ephemeral plugin path ${plugin} in ${file}: the Sabi controller state home must be a durable directory when installing into a real OpenCode config`,
    )
  }
  mkdirSync(path.dirname(plugin), { recursive: true, mode: 0o700 })
  copyFileSync(source, plugin)
  const config = readObject(file, { $schema: 'https://opencode.ai/config.json' })
  const current = config.plugin
  if (current !== undefined && !Array.isArray(current)) throw new Error(`${file}.plugin must be an array`)
  // Prune stale Sabi entries (ephemeral leftovers, dead files) left by earlier
  // installs before registering the current plugin path.
  const plugins = ((current as unknown[] | undefined) ?? []).filter((entry) => !isStaleSabiPluginEntry(entry))
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
    const hasBackup = existsSync(backup)
    // A deleted config stays deleted: uninstall strips Sabi entries from files
    // that exist and never recreates a file the user removed. The backup has
    // served its purpose once uninstall runs, so it is removed rather than
    // kept for a later run to resurrect.
    if (!existsSync(file)) {
      if (hasBackup) removeBackup(backup)
      return { harness, path: file, restored: false }
    }
    try {
      const current = readObject(file, {})
      let changed = false
      if (harness === 'opencode') {
        const plugins = current.plugin
        if (Array.isArray(plugins)) {
          const installed = path.resolve(controllerStateDir(env), 'hooks', 'opencode.mjs')
          // Remove the current install plus stale Sabi entries (ephemeral test
          // leftovers, dead files); a different durable Sabi install and unrelated
          // user plugins are preserved.
          const filtered = plugins.filter((plugin) =>
            typeof plugin !== 'string' || (plugin !== installed && !isStaleSabiPluginEntry(plugin)))
          changed = filtered.length !== plugins.length
          if (changed) {
            if (filtered.length) current.plugin = filtered
            else delete current.plugin
          }
        }
      } else {
        const hooks = current.hooks
        if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
          for (const [event, entries] of Object.entries(hooks as JsonObject)) {
            if (!Array.isArray(entries)) continue
            const filtered = entries.filter((entry) => !isSabiHookEntry(entry, harness))
            if (filtered.length !== entries.length) {
              changed = true
              if (filtered.length) (hooks as JsonObject)[event] = filtered
              else delete (hooks as JsonObject)[event]
            }
          }
          if (Object.keys(hooks).length === 0) delete current.hooks
        }
      }
      if (changed) {
        const keys = Object.keys(current)
        const onlySabiConfig = !hasBackup && (keys.length === 0 || (harness === 'opencode' && keys.every((key) => key === '$schema')))
        if (onlySabiConfig) unlinkSync(file)
        else writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
      }
      if (hasBackup) removeBackup(backup)
      return { harness, path: file, restored: changed }
    } catch {
      return { harness, path: file, restored: false }
    }
  })
}

function removeBackup(backup: string): void {
  try {
    unlinkSync(backup)
  } catch {
    // The backup is best-effort cleanup; a missing or locked file must not
    // fail the uninstall that has already done its work.
  }
}

export interface HookHealth {
  harness: InstalledHook
  path: string
  installed: boolean
  stale: boolean
  detail: string
}

function hookExecutableTargets(command: string): string[] {
  let tokens: string[]
  try {
    tokens = splitHookCommand(command)
  } catch {
    return []
  }
  if (!tokens.length) return []
  const targets = [tokens[0] as string]
  if (tokens.length >= 3 && tokens[2] === 'hook' && tokens[1] && /[/\\]|\.m?js$|\.ts$/.test(tokens[1] as string)) {
    targets.push(tokens[1] as string)
  }
  return targets
}

function missingAbsoluteTarget(targets: string[]): string | undefined {
  // Bare executable names rely on the host shell's PATH at hook runtime and
  // cannot be verified from here; only baked absolute paths go stale.
  for (const target of targets) {
    if (!path.isAbsolute(target)) continue
    if (!existsSync(target)) return target
  }
  return undefined
}

function sabiHookCommands(value: JsonObject, harness: HookHarness): string[] {
  const commands: string[] = []
  const hooks = value.hooks
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return commands
  for (const entries of Object.values(hooks as JsonObject)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!isSabiHookEntry(entry, harness)) continue
      const list = (entry as JsonObject).hooks
      if (!Array.isArray(list)) continue
      for (const hook of list) {
        if (hook !== null && typeof hook === 'object' && !Array.isArray(hook)) {
          const command = (hook as JsonObject).command
          if (typeof command === 'string') commands.push(command)
        }
      }
    }
  }
  return commands
}

/**
 * Report whether installed Sabi hooks still resolve. Version-managed Node
 * upgrades and moved checkouts leave baked absolute paths pointing at nothing;
 * the hook then fails and Sabi silently fails open, so `sabi doctor` surfaces
 * the staleness instead. Repair is the existing `sabi hooks install`.
 */
export function checkHookHealth(options: { env?: NodeJS.ProcessEnv } = {}): HookHealth[] {
  const env = options.env ?? process.env
  const paths: Record<InstalledHook, string> = {
    claude: claudeSettingsPath(env),
    codex: codexHooksPath(env),
    opencode: openCodeConfigPath(env),
  }
  return (['claude', 'codex', 'opencode'] as InstalledHook[]).map((harness) => {
    const file = paths[harness]
    if (!existsSync(file)) return { harness, path: file, installed: false, stale: false, detail: 'not installed' }
    let current: JsonObject
    try {
      current = readObject(file, {})
    } catch {
      return { harness, path: file, installed: false, stale: false, detail: 'unreadable config; run sabi hooks install to repair' }
    }
    if (harness === 'opencode') {
      const plugins = current.plugin
      if (!Array.isArray(plugins)) return { harness, path: file, installed: false, stale: false, detail: 'not installed' }
      const installed = path.resolve(controllerStateDir(env), 'hooks', 'opencode.mjs')
      const candidates = (plugins as unknown[]).filter((plugin): plugin is string =>
        typeof plugin === 'string' && (plugin === installed || /sabi/i.test(plugin)))
      if (!candidates.length) return { harness, path: file, installed: false, stale: false, detail: 'not installed' }
      const staleEntries = candidates.filter((candidate) => isStaleSabiPluginEntry(candidate))
      if (staleEntries.length) {
        return {
          harness, path: file, installed: true, stale: true,
          detail: `${staleEntries.length} stale Sabi plugin entr${staleEntries.length === 1 ? 'y' : 'ies'} (ephemeral or dead); run sabi hooks install to prune`,
        }
      }
      const missing = missingAbsoluteTarget(candidates)
      if (missing) return { harness, path: file, installed: true, stale: true, detail: `hook plugin missing ${missing}; run sabi hooks install to repair` }
      return { harness, path: file, installed: true, stale: false, detail: `${candidates.length} plugin(s) resolve` }
    }
    const commands = sabiHookCommands(current, harness)
    if (!commands.length) return { harness, path: file, installed: false, stale: false, detail: 'not installed' }
    for (const command of commands) {
      const missing = missingAbsoluteTarget(hookExecutableTargets(command))
      if (missing) return { harness, path: file, installed: true, stale: true, detail: `hook points at missing ${missing}; run sabi hooks install to repair` }
    }
    return { harness, path: file, installed: true, stale: false, detail: `${commands.length} hook(s) resolve` }
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
  const receipt = objectValue(execution.receipt ?? {}, 'controller receipt')
  return (execution.status === 'started' || execution.status === 'completed' || execution.status === 'rerouted') &&
    (receipt?.phase === 'accepted' || receipt?.phase === 'started' || receipt?.phase === 'completed')
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

function terminalHandleFrom(input: JsonObject): string | undefined {
  for (const key of ['terminal_id', 'terminalId', 'orca_terminal_handle', 'orcaTerminalHandle']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim()
  }
  return undefined
}

function idempotencyKeyFrom(input: JsonObject): string | undefined {
  for (const key of ['event_id', 'eventId', 'turn_id', 'turnId', 'request_id', 'requestId']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim().slice(0, 200)
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
    const terminalHandle = terminalHandleFrom(input) ?? env.ORCA_TERMINAL_HANDLE?.trim()
    const idempotencyKey = idempotencyKeyFrom(input)
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
      body: { request, cwd, currentSession: terminalHandle ?? sessionId, currentHarness: harness, waitMs: 5000, ...(idempotencyKey ? { idempotencyKey } : {}) },
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
        currentSession: terminalHandle ?? sessionId,
        currentHarness: harness,
        orchestrate: action === 'ORCHESTRATE',
        ...(override ? { override } : {}),
        waitMs: 5000,
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
