import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { CostBreakdown, CostRates, DecisionRecord, UsageTotals } from './types.ts'

/** Decisions land beside the work, not beside the installation: `./.sabi/decisions.jsonl`. */
export function defaultLogPath(): string {
  return process.env.SABI_LOG?.trim() || path.join(process.cwd(), '.sabi', 'decisions.jsonl')
}

/** Where the per-install identity salt lives: user-scoped, never in a repo. */
export function identitySaltPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SABI_ID_SALT_FILE?.trim()
  if (override) return override
  const base = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(base, 'sabi', '.identity-salt')
}

let cachedSalt: string | undefined
let cachedSaltSource: string | undefined
let ephemeralSaltWarned = false

/** Test helper: drop the cached salt so `SABI_ID_SALT`/`SABI_ID_SALT_FILE` changes take effect. */
export function resetIdentitySaltCache(): void {
  cachedSalt = undefined
  cachedSaltSource = undefined
}

function loadOrCreateSalt(source: string): string | undefined {
  try {
    if (existsSync(source)) {
      const stored = readFileSync(source, 'utf8').trim()
      if (stored.length >= 16) return stored
    }
    const fresh = randomBytes(32).toString('hex')
    mkdirSync(path.dirname(source), { recursive: true })
    writeFileSync(source, `${fresh}\n`, { mode: 0o600 })
    try { chmodSync(source, 0o600) } catch { /* best effort on existing files */ }
    return fresh
  } catch {
    return undefined
  }
}

/**
 * Per-install secret for identity hashing. An explicit `SABI_ID_SALT` wins (tests, managed
 * environments); otherwise a random salt is created once beside the user config dir (`mode
 * 0600`). When neither is available the process falls back to an ephemeral per-process salt —
 * grouping still works within the process, but hashes are not stable across restarts.
 */
export function getIdentitySalt(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SABI_ID_SALT?.trim()
  if (override) return override
  const source = identitySaltPath(env)
  if (cachedSalt !== undefined && cachedSaltSource === source) return cachedSalt
  const salt = loadOrCreateSalt(source)
  if (salt === undefined) {
    if (!ephemeralSaltWarned) {
      ephemeralSaltWarned = true
      console.warn(`Sabi: identity salt at ${source} is unreadable — using an ephemeral per-process salt`)
    }
    cachedSalt = randomBytes(32).toString('hex')
    cachedSaltSource = source
    return cachedSalt
  }
  cachedSalt = salt
  cachedSaltSource = source
  return salt
}

let logWriteFailures = 0
const warnedLogFiles = new Set<string>()

/** In-memory count of failed decision-log writes for this process. */
export function decisionLogWriteFailures(): number {
  return logWriteFailures
}

/** Test helper: reset the in-memory failure count and the once-per-file stderr warnings. */
export function resetLogWriteFailuresForTests(): void {
  logWriteFailures = 0
  warnedLogFiles.clear()
}

export interface LogWriteFailureState {
  failures: number
  lastTs: string
  lastError: string
}

/** Persistent sidecar beside the log file, so `report` can surface write failures. */
export function logWriteFailurePath(logFile: string): string {
  return `${logFile}.write-failures.json`
}

/** Best-effort persistent failure record; never throws — the log path is already degraded. */
function recordLogWriteFailure(logFile: string, error: unknown): void {
  logWriteFailures += 1
  if (!warnedLogFiles.has(logFile)) {
    warnedLogFiles.add(logFile)
    console.warn(`Sabi: could not append to the decision log at ${logFile}: ${(error as Error)?.message ?? error} (telemetry degraded, will retry next round)`)
  }
  try {
    const sidecar = logWriteFailurePath(logFile)
    let failures = 0
    try {
      const prior = JSON.parse(readFileSync(sidecar, 'utf8')) as Partial<LogWriteFailureState>
      if (typeof prior.failures === 'number' && Number.isFinite(prior.failures)) failures = Math.floor(prior.failures)
    } catch { /* no usable prior state — start from zero */ }
    const state: LogWriteFailureState = {
      failures: failures + 1,
      lastTs: new Date().toISOString(),
      lastError: String((error as Error)?.message ?? error).slice(0, 120),
    }
    mkdirSync(path.dirname(sidecar), { recursive: true })
    writeFileSync(sidecar, `${JSON.stringify(state)}\n`)
  } catch { /* the disk is the problem — stderr already carries the signal */ }
}

/** Read the persistent write-failure sidecar; undefined when no failure was ever recorded. */
export function readLogWriteFailures(logFile = defaultLogPath()): LogWriteFailureState | undefined {
  try {
    const state = JSON.parse(readFileSync(logWriteFailurePath(logFile), 'utf8')) as Partial<LogWriteFailureState>
    if (typeof state.failures !== 'number' || !Number.isFinite(state.failures) || state.failures < 1) return undefined
    return {
      failures: Math.floor(state.failures),
      lastTs: typeof state.lastTs === 'string' ? state.lastTs : 'unknown',
      lastError: typeof state.lastError === 'string' ? state.lastError : 'unknown',
    }
  } catch {
    return undefined
  }
}

export function appendDecision(record: DecisionRecord, logFile = defaultLogPath()): void {
  try {
    mkdirSync(path.dirname(logFile), { recursive: true })
    appendFileSync(logFile, `${JSON.stringify(record)}\n`)
  } catch (error) {
    // Telemetry is evidence, never a reason to break the serving path: surface the failure
    // on stderr (once per file) and in the persistent sidecar, then keep serving.
    recordLogWriteFailure(logFile, error)
  }
}

/** One JSON object per line, malformed lines skipped — the read side of `appendDecision`.
 * Missing file returns an empty array rather than throwing: no traffic yet is not an error.
 * Lines that parse but are not plain objects (`null`, numbers, arrays) are skipped as well:
 * they carry no record shape for any consumer to trust. */
export function readDecisions(logFile = defaultLogPath()): DecisionRecord[] {
  if (!existsSync(logFile)) return []
  const rows: DecisionRecord[] = []
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      rows.push(value as DecisionRecord)
    } catch {
      // skip malformed line
    }
  }
  return rows
}

export function emptyUsage(): UsageTotals {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 }
}

/** HMAC-SHA256 with a per-install salt: identical inputs hash identically on this
 * machine only, so the small tool/command namespace is not dictionary-reversible and two
 * installs are not trivially correlatable. Never the raw identifier. */
export function hashIdentity(kind: 'session' | 'turn' | 'tool', ...parts: string[]): string {
  return createHmac('sha256', getIdentitySalt()).update(JSON.stringify([kind, ...parts])).digest('hex')
}

/** No explicit session means no grouping. Never derive identity from prompt content. */
export function sessionIdFor(session?: string, client = 'unknown'): string {
  return session === undefined ? randomUUID() : hashIdentity('session', client, session)
}

export function estimateCost(usage: UsageTotals, rates?: CostRates): CostBreakdown | undefined {
  if (!rates || ![rates.input, rates.output, rates.cacheRead ?? rates.input]
    .every((rate) => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0)) return undefined
  if (![usage.promptTokens, usage.completionTokens, usage.cachedTokens, usage.totalTokens]
    .every((tokens) => Number.isSafeInteger(tokens) && tokens >= 0)) return undefined
  const cached = Math.max(0, Math.min(usage.cachedTokens, usage.promptTokens))
  const uncached = Math.max(0, usage.promptTokens - cached)
  const input = (uncached * rates.input + cached * (rates.cacheRead ?? rates.input)) / 1e6
  const output = (usage.completionTokens * rates.output) / 1e6
  const total = input + output
  return [input, output, total].every(Number.isFinite) ? { input, output, total } : undefined
}
