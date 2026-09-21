/**
 * Decision signals (Phase 0: types + store, no behavior).
 *
 * A signal is the smallest typed judgment Sabi can make about a trajectory:
 * one fact, one confidence, explicit provenance. Later phases join signals into
 * interventions (`failure + progress + verification + coverage -> repair`) and
 * split one batched Jev inference into several signals. This module only defines
 * the shape, the bounded store and the lineage formatter. Nothing routes on
 * signals yet; every signal is born in `observe` or `shadow` mode.
 *
 * Privacy: a signal carries `{ kind, id }` evidence references, never raw
 * prompt, tool-output or secret text. Values must stay JSON-safe scalars
 * (boolean, number or short string); anything else is rejected at emit time.
 */

export type SignalSource =
  | 'deterministic'
  | 'jev'
  | 'model'
  | 'host'
  | 'provider'
  | 'verification'

export type SignalMode = 'observe' | 'shadow' | 'apply'

/** The initial closed kind set. Extend only with a spec entry and a test. */
export const KNOWN_SIGNAL_KINDS = [
  'failure.real',
  'failure.transport',
  'progress.stalled',
  'verification.complete',
  'coverage',
  'context.pressure',
  'context.staleness',
  'task.ambiguity',
  'mutation.risk',
  'retry.value',
  'evidence.nextValue',
  'model.requiredStrength',
] as const

export type SignalKind = (typeof KNOWN_SIGNAL_KINDS)[number]

const KNOWN_KINDS: ReadonlySet<string> = new Set(KNOWN_SIGNAL_KINDS)
const SOURCES: ReadonlySet<string> = new Set([
  'deterministic',
  'jev',
  'model',
  'host',
  'provider',
  'verification',
])
const MODES: ReadonlySet<string> = new Set(['observe', 'shadow', 'apply'])

/** Opaque pointer to the event or receipt a signal derives from. Never text. */
export interface EvidenceRef {
  kind: string
  id: string
}

export type SignalValue = boolean | number | string

export interface DecisionSignal {
  id: string
  kind: SignalKind
  value: SignalValue
  confidence: number
  sessionId: string
  operationId?: string
  roundId?: string
  source: SignalSource
  evidence: EvidenceRef[]
  dependsOn?: string[]
  supersedes?: string[]
  observedAt: number
  expiresAt?: number
  mode: SignalMode
  /** Set when another signal names this id in `supersedes`. Audit trail only. */
  superseded?: boolean
}

export const MAX_SIGNALS_PER_SCOPE = 64
export const MAX_SIGNAL_AGE_MS = 300_000
export const MAX_EVIDENCE_REFS = 8
export const MAX_ID_CHARS = 128
export const MAX_VALUE_CHARS = 240

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  return ID_PATTERN.test(candidate) ? candidate : undefined
}

function cleanRef(value: unknown): EvidenceRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const kind = cleanId(record.kind)
  const id = cleanId(record.id)
  return kind && id ? { kind, id } : undefined
}

/** Fail-closed validation for one signal. Returns the reason it is unusable. */
export function signalProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'not-an-object'
  const record = value as Record<string, unknown>
  if (!cleanId(record.id)) return 'bad-id'
  if (typeof record.kind !== 'string' || !KNOWN_KINDS.has(record.kind)) return 'unknown-kind'
  const scalar = record.value
  if (typeof scalar !== 'boolean' && typeof scalar !== 'number' && typeof scalar !== 'string') {
    return 'bad-value'
  }
  if (typeof scalar === 'string' && scalar.length > MAX_VALUE_CHARS) return 'value-too-long'
  if (typeof scalar === 'number' && !Number.isFinite(scalar)) return 'bad-value'
  if (typeof record.confidence !== 'number' || !(record.confidence >= 0 && record.confidence <= 1)) {
    return 'bad-confidence'
  }
  if (!cleanId(record.sessionId)) return 'bad-session'
  if (record.operationId !== undefined && !cleanId(record.operationId)) return 'bad-operation'
  if (roundIdOf(record) !== undefined && !cleanId(record.roundId)) return 'bad-round'
  if (typeof record.source !== 'string' || !SOURCES.has(record.source)) return 'bad-source'
  if (!Array.isArray(record.evidence)) return 'bad-evidence'
  if (record.evidence.length > MAX_EVIDENCE_REFS) return 'too-much-evidence'
  if (record.evidence.some((entry) => !cleanRef(entry))) return 'bad-evidence-ref'
  if (typeof record.observedAt !== 'number' || !Number.isSafeInteger(record.observedAt)) {
    return 'bad-observed-at'
  }
  if (typeof record.mode !== 'string' || !MODES.has(record.mode)) return 'bad-mode'
  return undefined
}

function roundIdOf(record: Record<string, unknown>): unknown {
  return record.roundId
}

export function isSignalFresh(signal: DecisionSignal, nowMs: number): boolean {
  if (signal.superseded === true) return false
  return signal.expiresAt === undefined || nowMs < signal.expiresAt
}

function scopeKey(sessionId: string, operationId?: string): string {
  return operationId ? `${sessionId}\0${operationId}` : sessionId
}

/**
 * Bounded per-scope signal store. Newest wins per id; scopes hold at most
 * MAX_SIGNALS_PER_SCOPE signals and entries older than MAX_SIGNAL_AGE_MS are
 * pruned on read. Superseded signals are flagged, never deleted, so the audit
 * trail survives. Time is injected (`nowMs`) for tests.
 */
export class SignalStore {
  private readonly scopes = new Map<string, Map<string, DecisionSignal>>()

  /** Emit a signal. Returns the rejection reason, or undefined when stored. */
  emit(input: DecisionSignal, nowMs: number): string | undefined {
    const problem = signalProblem(input)
    if (problem) return problem
    const scope = this.scopes.get(scopeKey(input.sessionId, input.operationId)) ?? new Map()
    this.scopes.set(scopeKey(input.sessionId, input.operationId), scope)
    scope.set(input.id, { ...input })
    for (const older of input.supersedes ?? []) {
      const previous = scope.get(older)
      if (previous) scope.set(older, { ...previous, superseded: true })
    }
    this.pruneScope(scope, nowMs)
    return undefined
  }

  latest(sessionId: string, kind: SignalKind, operationId?: string, nowMs = 0): DecisionSignal | undefined {
    const scope = this.scopes.get(scopeKey(sessionId, operationId))
    if (!scope) return undefined
    let best: DecisionSignal | undefined
    for (const signal of scope.values()) {
      if (signal.kind !== kind || !isSignalFresh(signal, nowMs)) continue
      if (!best || signal.observedAt > best.observedAt) best = signal
    }
    return best
  }

  byId(sessionId: string, id: string, operationId?: string): DecisionSignal | undefined {
    return this.scopes.get(scopeKey(sessionId, operationId))?.get(id)
  }

  size(sessionId: string, operationId?: string): number {
    return this.scopes.get(scopeKey(sessionId, operationId))?.size ?? 0
  }

  private pruneScope(scope: Map<string, DecisionSignal>, nowMs: number): void {
    if (scope.size <= MAX_SIGNALS_PER_SCOPE) {
      for (const [id, signal] of scope) {
        if (nowMs - signal.observedAt > MAX_SIGNAL_AGE_MS) scope.delete(id)
      }
      return
    }
    const ordered = [...scope.values()].sort((a, b) => a.observedAt - b.observedAt)
    for (const stale of ordered.slice(0, scope.size - MAX_SIGNALS_PER_SCOPE)) {
      scope.delete(stale.id)
    }
  }
}

function formatValue(value: SignalValue): string {
  return typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value)
}

/**
 * Render the lineage of one derived signal: the decision, its confidence, the
 * input signals it was derived from, and the source events behind those. This
 * is the "why did you switch models" answer. Unknown ids render as-is rather
 * than failing, so a partial store still explains.
 */
export function explainSignal(
  store: SignalStore,
  sessionId: string,
  id: string,
  operationId?: string,
): string[] {
  const root = store.byId(sessionId, id, operationId)
  if (!root) return [`unknown signal ${id}`]
  const lines = [`${root.kind} = ${formatValue(root.value)} (${root.confidence})`]
  for (const parentId of root.dependsOn ?? []) {
    const parent = store.byId(sessionId, parentId, operationId)
    lines.push(
      parent
        ? `because: ${parent.kind} = ${formatValue(parent.value)} (${parent.confidence})`
        : `because: ${parentId} (not retained)`,
    )
    if (parent) {
      for (const ref of parent.evidence) lines.push(`which depended on: ${ref.kind} ${ref.id}`)
    }
  }
  for (const ref of root.evidence) lines.push(`evidence: ${ref.kind} ${ref.id}`)
  return lines
}
