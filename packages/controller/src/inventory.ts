import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { queryOrcaTerminals, queryOrcaWorktrees, readOrcaTerminal, waitOrcaTerminal } from './orca.ts'
import type { AgentHarness, AgentSession, AgentCapacity, OrcaErrorCode } from './types.ts'

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
  active: AgentSession
  existingSessions: AgentSession[]
  spawnCandidates: AgentHarness[]
}

const DEFAULT_HARNESSES: Array<{ agent: string; command: string }> = [
  { agent: 'codex', command: 'codex' },
  { agent: 'claude', command: 'claude' },
  { agent: 'opencode', command: 'opencode' },
  { agent: 'command-code', command: 'cmd' },
  { agent: 'omp', command: 'omp' },
  { agent: 'pi', command: 'pi' },
]

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
  const root = result.result
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return ''
  const terminal = (root as Record<string, unknown>).terminal
  if (terminal === null || typeof terminal !== 'object' || Array.isArray(terminal)) return ''
  const tail = (terminal as Record<string, unknown>).tail
  return Array.isArray(tail) ? tail.filter((line): line is string => typeof line === 'string').join('\n') : ''
}

function tuiIdleState(handle: string): boolean | undefined {
  const result = waitOrcaTerminal(handle, 'tui-idle', 1000)
  if (!result.ok || result.result === undefined || result.result === null || typeof result.result !== 'object' || Array.isArray(result.result)) return undefined
  const wait = (result.result as Record<string, unknown>).wait
  if (wait === null || typeof wait !== 'object' || Array.isArray(wait)) return undefined
  const satisfied = (wait as Record<string, unknown>).satisfied
  return typeof satisfied === 'boolean' ? satisfied : undefined
}

function executableExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore', timeout: 2000 })
    return true
  } catch {
    return false
  }
}

export function configuredHarnesses(): Array<{ agent: string; command: string }> {
  const configured = process.env.SABI_CONTROLLER_HARNESSES?.split(',').map((value) => value.trim()).filter(Boolean)
  if (!configured?.length) return DEFAULT_HARNESSES.filter(({ command }) => executableExists(command))
  return configured.map((agent) => ({ agent, command: agent })).filter(({ command }) => executableExists(command))
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
    lifecycle: 'dead',
    authenticated: false,
  }
}

export function discoverAgents(
  cwd: string,
  options: { stuckSession?: boolean; now?: number } = {},
): AgentInventory {
  const resolvedCwd = path.resolve(cwd)
  const now = options.now ?? Date.now()
  const currentHandle = process.env.ORCA_TERMINAL_HANDLE?.trim() || undefined
  const worktreesResult = queryOrcaWorktrees()
  const terminalsResult = queryOrcaTerminals()
  const worktrees = (worktreesResult.worktrees ?? []) as OrcaWorktreeEntry[]
  const terminalEntries = (terminalsResult.terminals ?? []) as OrcaTerminalEntry[]
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
  const active = sessions.find((session) => session.handle === currentHandle) ?? unavailableCurrent(resolvedCwd, now)
  const existingSessions = sessions.filter((session) => session.id !== active.id)
  const orcaAvailable = worktreesResult.ok || terminalsResult.ok
  const knownAgentState = new Map<string, AgentSession>()
  for (const session of sessions) {
    const previous = knownAgentState.get(session.agent)
    if (!previous || (!session.available && previous.available)) knownAgentState.set(session.agent, session)
  }
  const spawnCandidates: AgentHarness[] = orcaAvailable
    ? configuredHarnesses().map(({ agent, command }) => ({
      id: `harness:${agent}`,
      agent,
      harness: agent,
      command,
      capabilities: ['coding'],
      available: knownAgentState.get(agent)?.capacity.status === undefined
        ? true
        : knownAgentState.get(agent)!.available && knownAgentState.get(agent)!.capacity.status !== 'unavailable',
      capacity: knownAgentState.get(agent)?.capacity ?? { status: 'available' },
      kind: 'harness',
    }))
    : []
  return {
    orcaAvailable,
    errorCode: orcaAvailable ? undefined : (worktreesResult.errorCode ?? terminalsResult.errorCode),
    worktreeCount: worktrees.length,
    active,
    existingSessions,
    spawnCandidates,
  }
}
