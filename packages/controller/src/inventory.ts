import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ControllerConfig } from '@sabi/core'
import { parseTerminalReadReceipt, parseTerminalWaitReceipt, queryOrcaTerminals, queryOrcaWorktrees, readOrcaTerminal, waitOrcaTerminal } from './orca.ts'
import type {
  AgentHarness,
  AgentSession,
  AgentCapacity,
  HarnessCatalogDescriptor,
  HarnessModelDescriptor,
  OrcaErrorCode,
} from './types.ts'

interface OrcaTerminalEntry {
  handle?: unknown
  worktreePath?: unknown
  branch?: unknown
  connected?: unknown
  writable?: unknown
  orphaned?: unknown
  title?: unknown
  preview?: unknown
  agentIdentity?: unknown
  lastOutputAt?: unknown
}

interface OrcaWorktreeEntry {
  path?: unknown
  branch?: unknown
}

export interface AgentInventory {
  orcaAvailable: boolean
  errorCode?: OrcaErrorCode
  worktreeCount: number
  observedAt: number
  cached: boolean
  matchingWorktree: boolean
  matchingTerminal: boolean
  active: AgentSession
  existingSessions: AgentSession[]
  spawnCandidates: AgentHarness[]
}

const DEFAULT_HARNESSES: Array<{ agent: string; command: string }> = [
  { agent: 'codex', command: 'codex' },
  { agent: 'claude', command: 'claude' },
  { agent: 'opencode', command: 'opencode' },
  { agent: 'command-code', command: 'cmd' },
  { agent: 'hermes', command: 'hermes' },
  { agent: 'omp', command: 'omp' },
  { agent: 'pi', command: 'pi' },
]

const MODEL_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9._/-])?$/
const MODEL_LIST_HEADERS = new Set(['available', 'models', 'open', 'source', 'built-in', 'other'])
const MODEL_CATALOG_TIMEOUT_MS = 10_000
const MODEL_CATALOG_TTL_MS = 60_000
const MODEL_CATALOG_MAX_MODELS = 256
// ponytail: a short process cache avoids two slow CLI probes per request; lower the TTL or add an
// explicit refresh if plan changes need to be visible inside an already-running daemon.
const localCatalogCache = new Map<string, { catalog: HarnessCatalogDescriptor | undefined; observedAt: number }>()
const INVENTORY_TTL_MS = 2_000
const inventoryCache = new Map<string, { inventory: AgentInventory; storedAt: number }>()

export function parseModelList(output: string): string[] {
  const models = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    const candidate = trimmed.split(/\s+/, 1)[0] ?? ''
    const isHeading = MODEL_LIST_HEADERS.has(candidate.toLowerCase()) || /^(?:docs?|pass)\b/i.test(trimmed)
    const looksLikeModel = /[0-9./:_-]/.test(candidate)
    if (candidate && !isHeading && looksLikeModel && MODEL_ID.test(candidate)) models.add(candidate)
  }
  return [...models]
}

export function selectPreferredModel(output: string, preferredModels: string[]): string | undefined {
  const models = new Set(parseModelList(output))
  return preferredModels.find((model) => models.has(model) && modelRole(model) === 'worker')
}

function modelCostClass(model: string): HarnessModelDescriptor['costClass'] {
  return /(?:-|:)free$/i.test(model) ? 'explicit-free' : 'unknown'
}

function modelRole(model: string): HarnessModelDescriptor['role'] {
  return /(?:^|\/)jev(?:[-/:]|$)/i.test(model) ? 'judge' : 'worker'
}

export function parseModelCatalog(
  output: string,
  metadata: { command: string; runtimeVersion?: string; observedAt?: number },
): HarnessCatalogDescriptor {
  const parsedModels = parseModelList(output)
  const models: HarnessModelDescriptor[] = parsedModels.slice(0, MODEL_CATALOG_MAX_MODELS).map((id) => ({
    id,
    costClass: modelCostClass(id),
    role: modelRole(id),
  }))
  return {
    command: metadata.command,
    ...(metadata.runtimeVersion ? { runtimeVersion: metadata.runtimeVersion } : {}),
    outputSha256: createHash('sha256').update(output).digest('hex'),
    observedAt: metadata.observedAt ?? Date.now(),
    modelCount: parsedModels.length,
    ...(parsedModels.length > MODEL_CATALOG_MAX_MODELS ? { truncated: true } : {}),
    models,
  }
}

function runtimeVersion(command: string): string | undefined {
  try {
    const output = execFileSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 64_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const firstLine = output.split(/\r?\n/, 1)[0]?.trim()
    if (!firstLine || !/^[A-Za-z0-9][A-Za-z0-9._+:/ -]*$/.test(firstLine)) return undefined
    return firstLine.slice(0, 160)
  } catch {
    return undefined
  }
}

function localCatalog(agent: string, command: string): HarnessCatalogDescriptor | undefined {
  const key = `${agent}:${command}`
  const cached = localCatalogCache.get(key)
  if (cached && Date.now() - cached.observedAt < MODEL_CATALOG_TTL_MS) return cached.catalog
  const args = agent === 'opencode' ? ['models'] : ['--list-models']
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      timeout: MODEL_CATALOG_TIMEOUT_MS,
      maxBuffer: 2_000_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const catalog = parseModelCatalog(output, { command, runtimeVersion: runtimeVersion(command) })
    localCatalogCache.set(key, { catalog, observedAt: catalog.observedAt })
    return catalog
  } catch {
    localCatalogCache.set(key, { catalog: undefined, observedAt: Date.now() })
    return undefined
  }
}

function preferredModel(catalog: HarnessCatalogDescriptor | undefined, preferredModels: string[] | undefined): string | undefined {
  if (!preferredModels?.length) return undefined
  return catalog === undefined ? undefined : preferredModels.find((model) => catalog.models.some((entry) => entry.id === model && entry.role === 'worker'))
}

function launchCommand(command: string, model: string | undefined): string | undefined {
  return model && MODEL_ID.test(model) ? `${command} --model ${model}` : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function durationMs(text: string): number | undefined {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/gi)]
  if (!matches.length) return undefined
  let total = 0
  for (const match of matches) {
    const value = Number(match[1])
    const unit = match[2]!.toLowerCase()
    const multiplier = unit.startsWith('d') ? 86_400_000 : unit.startsWith('h') ? 3_600_000 : unit.startsWith('m') ? 60_000 : 1000
    total += value * multiplier
  }
  return Math.max(0, Math.round(total))
}

function redactContext(text: string): string {
  return text
    .replace(/([?&](?:token|access_token|refresh_token|reset_password_token|api_key|apikey|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passphrase|secret|token|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}

function capacityFromText(text: string, now: number): AgentCapacity {
  const lower = text.toLowerCase()
  const resetAfter = durationMs(lower)
  const resetAt = resetAfter === undefined ? undefined : now + resetAfter
  const fallbackMode = lower.includes('lower priority')
    ? 'lower_priority'
    : lower.includes('cheaper model')
      ? 'cheaper_model'
      : undefined
  if (/usage limit|weekly limit|session limit|quota|insufficient_quota|plan limit|on-demand credits/i.test(lower)) {
    return { status: 'quota_exhausted', resetAt, fallbackMode }
  }
  if (/rate[- ]?limit|too many requests|\b429\b/i.test(lower)) {
    return { status: 'rate_limited', resetAt, fallbackMode }
  }
  if (/authentication|unauthorized|\b401\b|login required/i.test(lower)) return { status: 'unavailable' }
  return { status: 'available' }
}

function lifecycleFromEntry(entry: OrcaTerminalEntry, tuiIdle: boolean | undefined): AgentSession['lifecycle'] {
  if (entry.orphaned === true || entry.connected === false) return 'dead'
  if (tuiIdle === true) return 'idle'
  // A failed wait is live evidence of work; a missing wait result is not enough to call a
  // session idle. Historical screen text contains old errors and quota messages, so it must
  // never manufacture a current blocked state.
  return 'active'
}

function observedScreen(handle: string): string {
  const result = readOrcaTerminal(handle, 80)
  return parseTerminalReadReceipt(result.result)?.terminal.tail.join('\n') ?? ''
}

function tuiIdleState(handle: string): boolean | undefined {
  const result = waitOrcaTerminal(handle, 'tui-idle', 1000)
  return parseTerminalWaitReceipt(result.result)?.satisfied
}

function executableExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore', timeout: 2000 })
    return true
  } catch {
    return false
  }
}

export function configuredHarnesses(controller?: ControllerConfig): Array<{
  agent: string
  command: string
  model?: string
  launchCommand?: string
  modelRequired?: boolean
  catalog?: HarnessCatalogDescriptor
}> {
  const configured = process.env.SABI_CONTROLLER_HARNESSES?.split(',').map((value) => value.trim()).filter(Boolean)
  const definitions = !configured?.length
    ? DEFAULT_HARNESSES
    : configured.map((agent) => ({ agent, command: agent }))
  return definitions.filter(({ command }) => executableExists(command)).map(({ agent, command }) => {
    const preferredModels = controller?.harnesses?.[agent]?.preferredModels
    // Only probe catalogs with a verified local command contract. Other harnesses may interpret
    // --list-models as a normal invocation; a configured preference remains an explicit opt-in.
    const shouldProbe = agent === 'opencode' || agent === 'command-code' || Boolean(preferredModels?.length)
    const catalog = shouldProbe ? localCatalog(agent, command) : undefined
    const model = preferredModel(catalog, preferredModels)
    return {
      agent,
      command,
      ...(model ? { model, launchCommand: launchCommand(command, model) } : {}),
      ...(preferredModels?.length ? { modelRequired: true } : {}),
      ...(catalog ? { catalog } : {}),
    }
  })
}

function makeSession(
  entry: OrcaTerminalEntry,
  worktreePath: string,
  branch: string | undefined,
  currentHandle: string | undefined,
  stuck: boolean,
  now: number,
  observed: string,
  tuiIdle: boolean | undefined,
): AgentSession | undefined {
  const handle = stringValue(entry.handle)
  const worktree = stringValue(entry.worktreePath)
  const agent = stringValue(entry.agentIdentity) ?? 'unknown'
  if (!handle || !worktree || path.resolve(worktree) !== path.resolve(worktreePath)) return undefined
  const preview = stringValue(entry.preview) ?? ''
  const title = stringValue(entry.title)
  const context = redactContext(title ? `${title}${preview ? ` | ${preview.slice(0, 160)}` : ''}` : preview.slice(0, 160))
  const lifecycle = lifecycleFromEntry(entry, tuiIdle)
  // An idle screen is historical by definition: it may contain a previous limit or stop-hook
  // message after the agent has recovered. Capacity failures are still detectable while a
  // session is actively working; a failed live send remains the authoritative fallback.
  const capacity = capacityFromText(tuiIdle === true ? '' : `${title ?? ''} ${preview} ${observed}`, now)
  const authenticated = capacity.status === 'unavailable' ? false : undefined
  const isCurrent = currentHandle === handle
  const available = Boolean(entry.connected !== false && entry.orphaned !== true && entry.writable !== false &&
    authenticated !== false && (isCurrent || lifecycle === 'idle'))
  return {
    id: `session:${handle}`,
    agent,
    harness: agent,
    capabilities: ['coding'],
    available,
    capacity,
    worktree: path.resolve(worktree),
    branch: stringValue(entry.branch) ?? branch,
    context,
    lastOutputAt: finiteNumber(entry.lastOutputAt),
    kind: 'session',
    handle,
    dispatchable: true,
    lifecycle,
    authenticated,
    failureStreak: stuck && isCurrent && tuiIdle !== true ? 2 : 0,
  }
}

function unavailableCurrent(cwd: string, now: number): AgentSession {
  return {
    id: `session:current:${cwd}`,
    agent: 'current',
    harness: 'unknown',
    capabilities: ['coding'],
    available: false,
    capacity: { status: 'unavailable', resetAt: now },
    worktree: cwd,
    kind: 'session',
    dispatchable: false,
    lifecycle: 'dead',
    authenticated: false,
  }
}

function hostCurrentSession(cwd: string, sessionId: string, harness = 'current'): AgentSession {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 24)
  return {
    id: `session:host:${digest}`,
    agent: harness,
    harness,
    capabilities: ['coding'],
    available: true,
    capacity: { status: 'available' },
    worktree: cwd,
    context: 'current host session; execution remains with the harness',
    kind: 'session',
    dispatchable: false,
    lifecycle: 'active',
  }
}

export function discoverAgents(
  cwd: string,
  options: { stuckSession?: boolean; now?: number; controller?: ControllerConfig; currentSession?: string; currentHarness?: string; refresh?: boolean } = {},
): AgentInventory {
  const resolvedCwd = path.resolve(cwd)
  const now = options.now ?? Date.now()
  const currentHandle = options.currentSession?.trim() || process.env.ORCA_TERMINAL_HANDLE?.trim() || undefined
  const cacheKey = JSON.stringify([
    resolvedCwd,
    currentHandle,
    options.currentHarness?.trim() || '',
    process.env.ORCA_CLI_COMMAND?.trim() || 'orca-ide',
    process.env.SABI_CONTROLLER_HARNESSES?.trim() || '',
    Boolean(options.stuckSession),
    options.controller ?? {},
    options.controller?.preferredHarnesses ?? [],
    options.controller?.harnesses ?? {},
  ])
  const cached = options.now === undefined && options.refresh !== true ? inventoryCache.get(cacheKey) : undefined
  if (cached && Date.now() - cached.storedAt < INVENTORY_TTL_MS) return { ...cached.inventory, cached: true }
  const worktreesResult = queryOrcaWorktrees()
  const terminalsResult = queryOrcaTerminals()
  const worktrees = (worktreesResult.worktrees ?? []) as OrcaWorktreeEntry[]
  const terminalEntries = (terminalsResult.terminals ?? []) as OrcaTerminalEntry[]
  const matchingWorktree = worktrees.some((entry) => {
    const worktree = stringValue(entry.path)
    return worktree !== undefined && path.resolve(worktree) === resolvedCwd
  })
  const matchingTerminal = terminalEntries.some((entry) => {
    const worktree = stringValue(entry.worktreePath)
    return worktree !== undefined && path.resolve(worktree) === resolvedCwd
  })
  const branches = new Map(
    worktrees
      .map((entry) => {
        const worktree = stringValue(entry.path)
        return worktree ? [path.resolve(worktree), stringValue(entry.branch)] as const : undefined
      })
      .filter((entry): entry is readonly [string, string | undefined] => entry !== undefined),
  )
  const sessions = terminalEntries
    .map((entry) => {
      const handle = stringValue(entry.handle)
      const observed = handle ? observedScreen(handle) : ''
      const tuiIdle = handle ? tuiIdleState(handle) : undefined
      const worktree = stringValue(entry.worktreePath)
      return worktree
        ? makeSession(entry, worktree, branches.get(path.resolve(worktree)), currentHandle, Boolean(options.stuckSession), now, observed, tuiIdle)
        : undefined
    })
    .filter((entry): entry is AgentSession => entry !== undefined)
  const active = sessions.find((session) => session.handle === currentHandle) ??
    (options.currentSession ? hostCurrentSession(resolvedCwd, options.currentSession, options.currentHarness) : unavailableCurrent(resolvedCwd, now))
  const existingSessions = sessions.filter((session) => session.id !== active.id)
  const orcaAvailable = worktreesResult.ok || terminalsResult.ok
  const knownAgentState = new Map<string, AgentSession>()
  for (const session of sessions) {
    const previous = knownAgentState.get(session.agent)
    if (!previous || (!session.available && previous.available)) knownAgentState.set(session.agent, session)
  }
  const spawnCandidates: AgentHarness[] = orcaAvailable
    ? configuredHarnesses(options.controller).map(({ agent, command, model, launchCommand, modelRequired, catalog }) => ({
      id: `harness:${agent}`,
      agent,
      harness: agent,
      command,
      ...(model ? { model } : {}),
      ...(launchCommand ? { launchCommand } : {}),
      ...(catalog ? { catalog } : {}),
      capabilities: ['coding'],
      available: modelRequired && !model
        ? false
        : knownAgentState.get(agent)?.capacity.status === undefined
          ? true
          : knownAgentState.get(agent)!.available && knownAgentState.get(agent)!.capacity.status !== 'unavailable',
      capacity: modelRequired && !model
        ? { status: 'unavailable' }
        : knownAgentState.get(agent)?.capacity ?? { status: 'available' },
      kind: 'harness',
    }))
    : []
  const inventory: AgentInventory = {
    orcaAvailable,
    errorCode: orcaAvailable ? undefined : (worktreesResult.errorCode ?? terminalsResult.errorCode),
    worktreeCount: worktrees.length,
    observedAt: now,
    cached: false,
    matchingWorktree,
    matchingTerminal,
    active,
    existingSessions,
    spawnCandidates,
  }
  if (options.now === undefined) inventoryCache.set(cacheKey, { inventory, storedAt: Date.now() })
  return inventory
}

export function clearInventoryCache(): void {
  inventoryCache.clear()
}
