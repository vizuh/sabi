import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentCapacityStatus, AgentLifecycle } from './types.ts'
import type { ControllerExecutionReceipt, ControllerReceiptPhase } from './types.ts'

const MAX_SESSIONS = 128
const SESSION_TTL_MS = 10 * 60_000
const MAX_TEXT = 240
const CAPACITY_STATUSES: AgentCapacityStatus[] = ['available', 'degraded', 'rate_limited', 'quota_exhausted', 'unavailable']
const LIFECYCLES: AgentLifecycle[] = ['active', 'idle', 'blocked', 'waiting', 'dead']

export interface RegisteredSession {
  id: string
  adapter: string
  harness: string
  worktree: string
  branch?: string
  lifecycle: AgentLifecycle
  capacity: { status: AgentCapacityStatus; resetAt?: number }
  capabilities: string[]
  context?: string
  lastSeenAt: number
  dispatchable: false
  lastOutcome?: 'started' | 'completed' | 'failed' | 'unverifiable'
  lastReceipt?: ControllerExecutionReceipt
}

export interface RegisterSessionInput {
  sessionId: string
  adapter: string
  harness: string
  worktree: string
  branch?: string
  lifecycle?: AgentLifecycle
  capacity?: { status: AgentCapacityStatus; resetAt?: number }
  capabilities?: string[]
  context?: string
}

export function registryPath(stateDir: string): string {
  return path.join(stateDir, 'sessions.json')
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function safeContext(value: unknown): string | undefined {
  const context = text(value)
  return context
    ?.replace(/([?&](?:token|access_token|refresh_token|reset_password_token|api_key|apikey|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passphrase|secret|token|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}

function stableId(adapter: string, sessionId: string): string {
  const digest = createHash('sha256').update(`${adapter}\0${sessionId}`).digest('hex').slice(0, 24)
  return `registry:${adapter}:${digest}`
}

function receipt(value: unknown): ControllerExecutionReceipt | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const phases: ControllerReceiptPhase[] = ['accepted', 'started', 'completed', 'failed', 'unknown']
  if (!phases.includes(object.phase as ControllerReceiptPhase) || typeof object.observedAt !== 'string' || !object.observedAt.trim()) return undefined
  return {
    phase: object.phase as ControllerReceiptPhase,
    observedAt: object.observedAt.trim().slice(0, 80),
    ...(typeof object.requestId === 'string' && object.requestId.trim() ? { requestId: object.requestId.trim().slice(0, 200) } : {}),
  }
}

function validSession(value: unknown): value is RegisteredSession {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const session = value as Record<string, unknown>
  const capacity = session.capacity
  return typeof session.id === 'string' && typeof session.adapter === 'string' && typeof session.harness === 'string' &&
    typeof session.worktree === 'string' && typeof session.lastSeenAt === 'number' && Number.isFinite(session.lastSeenAt) &&
    LIFECYCLES.includes(session.lifecycle as AgentLifecycle) && capacity !== null && typeof capacity === 'object' && !Array.isArray(capacity) &&
    CAPACITY_STATUSES.includes((capacity as Record<string, unknown>).status as AgentCapacityStatus) &&
    Array.isArray(session.capabilities) && session.capabilities.every((item) => typeof item === 'string') && session.dispatchable === false &&
    (session.lastReceipt === undefined || receipt(session.lastReceipt) !== undefined)
}

function readAll(stateDir: string): RegisteredSession[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(registryPath(stateDir), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(validSession)
  } catch {
    return []
  }
}

function writeAll(stateDir: string, sessions: RegisteredSession[]): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const file = registryPath(stateDir)
  const temporary = `${file}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(sessions.slice(-MAX_SESSIONS), null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, file)
}

export function readSessionRegistry(stateDir: string, now = Date.now()): RegisteredSession[] {
  return readAll(stateDir).filter((session) => now - session.lastSeenAt <= SESSION_TTL_MS)
}

function normalizeInput(value: unknown, now: number): RegisteredSession {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('session registration must be an object')
  const input = value as Partial<RegisterSessionInput>
  const sessionId = text(input.sessionId, 512)
  if (!sessionId) throw new Error('sessionId is required')
  const adapter = text(input.adapter, 64)
  const harness = text(input.harness, 64)
  const worktree = text(input.worktree, 1024)
  if (!adapter || !harness || !worktree) throw new Error('adapter, harness and worktree are required')
  const capacityStatus = input.capacity?.status ?? 'available'
  if (!CAPACITY_STATUSES.includes(capacityStatus)) throw new Error(`unsupported capacity status '${capacityStatus}'`)
  const lifecycle = input.lifecycle ?? 'active'
  if (!LIFECYCLES.includes(lifecycle)) throw new Error(`unsupported lifecycle '${lifecycle}'`)
  const capabilities = [...new Set((Array.isArray(input.capabilities) ? input.capabilities : ['coding']).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 64)))].slice(0, 16)
  return {
    id: stableId(adapter, sessionId),
    adapter,
    harness,
    worktree: path.resolve(worktree),
    ...(text(input.branch, 256) ? { branch: text(input.branch, 256) } : {}),
    lifecycle,
    capacity: {
      status: capacityStatus,
      ...(typeof input.capacity?.resetAt === 'number' && Number.isFinite(input.capacity.resetAt) ? { resetAt: input.capacity.resetAt } : {}),
    },
    capabilities,
    ...(safeContext(input.context) ? { context: safeContext(input.context) } : {}),
    lastSeenAt: now,
    dispatchable: false,
  }
}

export function registerSession(stateDir: string, input: unknown, now = Date.now()): RegisteredSession {
  const session = normalizeInput(input, now)
  const sessions = readAll(stateDir).filter((entry) => entry.id !== session.id && now - entry.lastSeenAt <= SESSION_TTL_MS)
  sessions.push(session)
  writeAll(stateDir, sessions)
  return session
}

export function heartbeatSession(
  stateDir: string,
  input: unknown,
  now = Date.now(),
): RegisteredSession {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('session heartbeat must be an object')
  const value = input as Record<string, unknown>
  return registerSession(stateDir, { ...value, lifecycle: value.lifecycle ?? 'active' }, now)
}

export function recordSessionOutcome(
  stateDir: string,
  input: unknown,
  now = Date.now(),
): RegisteredSession {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('session outcome must be an object')
  const value = input as Record<string, unknown>
  if (value.outcome !== 'started' && value.outcome !== 'completed' && value.outcome !== 'failed' && value.outcome !== 'unverifiable') {
    throw new Error('outcome must be started, completed, failed or unverifiable')
  }
  const lastReceipt = value.receipt === undefined ? undefined : receipt(value.receipt)
  if (value.receipt !== undefined && !lastReceipt) throw new Error('receipt must include a known phase and observedAt')
  const outcome = value.outcome as NonNullable<RegisteredSession['lastOutcome']>
  const session = registerSession(stateDir, input, now)
  const sessions = readAll(stateDir)
  const updated = sessions.map((entry) => entry.id === session.id
    ? { ...entry, lastOutcome: outcome, ...(lastReceipt ? { lastReceipt } : {}) }
    : entry)
  writeAll(stateDir, updated)
  return updated.find((entry) => entry.id === session.id) ?? session
}
