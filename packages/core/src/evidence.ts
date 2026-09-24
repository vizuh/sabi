import { looksLikeCanary } from './telemetry.ts'
import type {
  ExecutionReceipt,
  EvidenceCode,
  EvidenceSource,
  EvidenceStatus,
  ScopeCoverage,
  ScopeCoverageSource,
  ScopeInput,
  TrajectoryEvidence,
  TrajectoryState,
  VerificationReason,
  VerificationReceipt,
  VerificationState,
  VerificationStatus,
} from './types.ts'

export const MAX_EVIDENCE_ITEMS = 16
export const MAX_EVIDENCE_DETAIL_CHARS = 240
export const MAX_EVIDENCE_SERIALIZED_CHARS = 4_000
export const MAX_SCOPE_ITEMS = 32
export const MAX_SCOPE_LABEL_CHARS = 120
export const MAX_RECEIPT_ID_CHARS = 128

const EVIDENCE_CODES: ReadonlySet<string> = new Set([
  'error-line',
  'python-traceback',
  'panic',
  'exception',
  'typescript-error',
  'fail-marker',
  'command-failed',
  'nonzero-exit',
  'failure-count',
  'command-not-found',
  'permission-denied',
  'missing-file',
  'soft-warning',
  'soft-deprecated',
  'soft-retrying',
  'soft-timeout',
  'tool-error',
  'permission-denial',
  'rate-limited',
  'quota-exceeded',
  'timeout',
  'mutation',
  'verification-receipt',
  'summary-claim',
  'scope-observed',
  'constraint',
  'prior-failure',
  'context-boundary',
  'observation',
])

const EVIDENCE_SOURCES: ReadonlySet<string> = new Set(['tool', 'user', 'harness', 'judge', 'summary'])
const EVIDENCE_STATUSES: ReadonlySet<string> = new Set(['observed', 'verified', 'unverified', 'contradicted'])
const VERIFICATION_STATUSES: ReadonlySet<string> = new Set(['not-required', 'needed', 'attempted', 'passed', 'failed', 'unknown'])
const VERIFICATION_REASONS: ReadonlySet<string> = new Set([
  'mutation-without-receipt',
  'summary-without-receipt',
  'stale-generation',
  'invalid-receipt',
  'missing-receipt',
  'scope-unknown',
  'user-denial',
  'contradicted',
  'verification-receipt',
])

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!text || looksLikeCanary(text)) return undefined
  return text.slice(0, maxChars)
}

function generationOf(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function isEvidenceCode(value: unknown): value is EvidenceCode {
  return typeof value === 'string' && EVIDENCE_CODES.has(value)
}

export function isEvidenceSource(value: unknown): value is EvidenceSource {
  return typeof value === 'string' && EVIDENCE_SOURCES.has(value)
}

export function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return typeof value === 'string' && EVIDENCE_STATUSES.has(value)
}

/** Normalize one untrusted item without retaining raw output, prompts, or secret-like text. */
export function normalizeTrajectoryEvidence(value: unknown, fallbackGeneration = 0): TrajectoryEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (!isEvidenceCode(item.code) || !isEvidenceSource(item.source) || !isEvidenceStatus(item.status)) return undefined
  const detail = boundedText(item.detail, MAX_EVIDENCE_DETAIL_CHARS)
  return {
    code: item.code,
    source: item.source,
    status: item.status,
    contextGeneration: generationOf(item.contextGeneration ?? fallbackGeneration),
    ...(detail ? { detail } : {}),
  }
}

/** Keep evidence records deterministic, bounded, and de-duplicated. */
export function boundTrajectoryEvidence(values: readonly unknown[] | undefined, maxItems = MAX_EVIDENCE_ITEMS): TrajectoryEvidence[] {
  const result: TrajectoryEvidence[] = []
  if (maxItems <= 0) return result
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const item = normalizeTrajectoryEvidence(value)
    if (!item) continue
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
    if (result.length >= Math.max(0, Math.min(maxItems, MAX_EVIDENCE_ITEMS))) break
  }
  return result
}

export const sanitizeEvidence = boundTrajectoryEvidence

/** Serialize evidence with a hard character ceiling; lower-value items are dropped first. */
export function serializeTrajectoryEvidence(values: readonly unknown[] | undefined, maxChars = MAX_EVIDENCE_SERIALIZED_CHARS): string {
  let bounded = boundTrajectoryEvidence(values)
  let encoded = JSON.stringify(bounded)
  while (encoded.length > maxChars && bounded.length > 0) {
    bounded = bounded.slice(0, -1)
    encoded = JSON.stringify(bounded)
  }
  return encoded.length <= maxChars ? encoded : '[]'
}

export const serializeEvidence = serializeTrajectoryEvidence

export function parseTrajectoryEvidence(value: unknown, maxChars = MAX_EVIDENCE_SERIALIZED_CHARS): TrajectoryEvidence[] {
  if (typeof value !== 'string' || value.length > maxChars) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? boundTrajectoryEvidence(parsed) : []
  } catch {
    return []
  }
}

export function mergeTrajectoryEvidence(...groups: Array<readonly unknown[] | undefined>): TrajectoryEvidence[] {
  return boundTrajectoryEvidence(groups.flatMap((group) => group ?? []))
}

function countScope(value: string[] | number | undefined): { count?: number; labels?: string[] } {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? { count: value } : {}
  if (!Array.isArray(value)) return {}
  const labels = [...new Set(value.map((item) => boundedText(item, MAX_SCOPE_LABEL_CHARS)).filter((item): item is string => Boolean(item)))].slice(0, MAX_SCOPE_ITEMS)
  return { count: labels.length, labels }
}

export function buildScopeCoverage(input: ScopeInput | undefined = {}): ScopeCoverage {
  const expected = countScope(input.expected)
  const observed = countScope(input.observed)
  const explicit = input.source === 'explicit' || input.expected !== undefined
  const source: ScopeCoverageSource = input.source ?? (explicit ? 'explicit' : input.observed !== undefined ? 'inferred' : 'unknown')
  const expectedCount = expected.count
  const observedCount = observed.count
  const ratio = expectedCount !== undefined && expectedCount > 0 && observedCount !== undefined
    ? Math.min(1, observedCount / expectedCount)
    : undefined
  const missing = input.missing
    ? [...new Set(input.missing.map((item) => boundedText(item, MAX_SCOPE_LABEL_CHARS)).filter((item): item is string => Boolean(item)))].slice(0, MAX_SCOPE_ITEMS)
    : expected.labels && observed.labels
      ? expected.labels.filter((item) => !observed.labels!.includes(item)).slice(0, MAX_SCOPE_ITEMS)
      : undefined
  return {
    ...(expectedCount !== undefined ? { expected: expectedCount } : {}),
    ...(observedCount !== undefined ? { observed: observedCount } : {}),
    ...(ratio !== undefined ? { ratio } : {}),
    source,
    ...(missing && missing.length > 0 ? { missing } : {}),
  }
}

export interface VerificationInput {
  mutation?: boolean
  verificationAttempted?: boolean
  summaryClaim?: boolean
  generation?: number
  receipt?: unknown
  executionReceipt?: ExecutionReceipt
}

function validReceipt(value: unknown, generation: number): VerificationReceipt | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const id = boundedText(item.id, MAX_RECEIPT_ID_CHARS)
  const status = item.status === 'passed' || item.status === 'failed' ? item.status : undefined
  const source = item.source === 'tool' || item.source === 'user' || item.source === 'harness' ? item.source : undefined
  const receiptGeneration = generationOf(item.generation)
  if (!id || !status || !source || item.valid === false || receiptGeneration !== generation) return undefined
  return { id, status, source, generation: receiptGeneration, ...(item.valid === true ? { valid: true } : {}) }
}

/**
 * Bridge a core `ExecutionReceipt` into the verification transition. An
 * execution receipt is a structured `ValidationReceipt`-class proof, not an
 * arbitrary claim. Statuses other than passed/failed are treated as missing.
 */
export function verificationFromExecutionReceipt(receipt: ExecutionReceipt, generation?: number): VerificationState {
  const generationValue = generationOf(generation)
  if (!receipt || typeof receipt !== 'object' || (receipt.status !== 'passed' && receipt.status !== 'failed')) {
    return { status: 'unknown', reason: 'invalid-receipt', generation: generationValue }
  }
  return {
    status: receipt.status,
    reason: 'verification-receipt',
    receiptId: receipt.operationId,
    generation: generationValue,
  }
}

/**
 * Select the strongest execution receipt for a given operation id from a
 * bounded collection. Deterministic and stable.
 */
export function strongestExecutionReceipt(receipts: ExecutionReceipt[], operationId: string): ExecutionReceipt | undefined {
  const matches = receipts.filter((r) => r.operationId === operationId && (r.status === 'passed' || r.status === 'failed'))
  if (matches.length === 0) return undefined
  const passed = matches.find((r) => r.status === 'passed')
  return passed ?? matches[matches.length - 1]
}

export function deriveVerificationState(input: VerificationInput = {}): VerificationState {
  const generation = generationOf(input.generation)
  const receiptCandidate = input.receipt
  if (receiptCandidate !== undefined) {
    const receipt = validReceipt(receiptCandidate, generation)
    if (receipt) return { status: receipt.status, receiptId: receipt.id, generation }
    return { status: 'unknown', reason: 'invalid-receipt', generation }
  }
  if (input.executionReceipt !== undefined) {
    return verificationFromExecutionReceipt(input.executionReceipt, input.generation)
  }
  if (input.summaryClaim) return { status: 'unknown', reason: 'summary-without-receipt', generation }
  if (input.mutation) return { status: 'needed', reason: 'mutation-without-receipt', generation }
  if (input.verificationAttempted) return { status: 'attempted', reason: 'missing-receipt', generation }
  return { status: 'not-required', generation }
}

export function transitionVerification(current: VerificationState | undefined, next: VerificationState, generation?: number): VerificationState {
  if (!current) return next
  const currentGeneration = current.generation ?? 0
  const nextGeneration = generationOf(generation ?? next.generation ?? currentGeneration)
  if (nextGeneration < currentGeneration) return current
  if (nextGeneration > currentGeneration && (current.status === 'passed' || current.status === 'failed') && next.status !== 'passed' && next.status !== 'failed') {
    return { ...next, status: 'unknown', reason: 'stale-generation', generation: nextGeneration, receiptId: undefined }
  }
  if ((current.status === 'passed' || current.status === 'failed') && (next.status === 'unknown' || next.status === 'attempted' || next.status === 'not-required')) {
    return { ...current, generation: nextGeneration }
  }
  return { ...next, generation: nextGeneration }
}

export function evidenceForTrajectory(state: Pick<TrajectoryState, 'failure' | 'failureEvidence' | 'roundKind' | 'contextGeneration'>, options: { summaryClaim?: boolean; verificationReceipt?: boolean } = {}): TrajectoryEvidence[] {
  const generation = generationOf(state.contextGeneration)
  const evidence: TrajectoryEvidence[] = []
  if (state.roundKind === 'implementation') evidence.push({ code: 'mutation', source: 'tool', status: 'observed', contextGeneration: generation })
  for (const code of state.failureEvidence) {
    if (isEvidenceCode(code)) evidence.push({ code, source: 'tool', status: 'observed', contextGeneration: generation })
  }
  if (options.verificationReceipt) evidence.push({ code: 'verification-receipt', source: 'harness', status: 'verified', contextGeneration: generation })
  if (options.summaryClaim) evidence.push({ code: 'summary-claim', source: 'summary', status: 'unverified', contextGeneration: generation })
  if (generation > 0) evidence.push({ code: 'context-boundary', source: 'harness', status: 'observed', contextGeneration: generation })
  return boundTrajectoryEvidence(evidence)
}

export function isFullyVerified(
  verification: VerificationState | undefined,
  coverage?: ScopeCoverage,
  currentGeneration?: number,
): boolean {
  if (verification?.status !== 'passed') return false
  if (currentGeneration !== undefined && verification.generation !== undefined && verification.generation !== currentGeneration) return false
  if (!coverage) return true
  if (coverage.source !== 'explicit') return false
  return coverage.expected !== undefined && coverage.expected > 0 && coverage.ratio === 1 && (coverage.missing?.length ?? 0) === 0
}

export function completionStatus(
  verification: VerificationState | undefined,
  coverage?: ScopeCoverage,
  currentGeneration?: number,
): 'verified' | 'unknown' {
  return isFullyVerified(verification, coverage, currentGeneration) ? 'verified' : 'unknown'
}

export interface TrajectoryEvidenceMetadata {
  generation?: number
  summaryClaim?: boolean
  verificationReceipt?: unknown
  executionReceipt?: ExecutionReceipt
  scope?: ScopeInput
}

/** Additive state decoration shared by the wire proxy and native harness adapter. */
export function decorateTrajectoryState<T extends TrajectoryState>(state: T, metadata: TrajectoryEvidenceMetadata = {}): T {
  const generation = generationOf(metadata.generation ?? state.contextGeneration)
  const receipt = metadata.verificationReceipt
  const executionReceipt = metadata.executionReceipt
  const verification = deriveVerificationState({
    mutation: state.roundKind === 'implementation',
    verificationAttempted: state.roundKind === 'verification',
    summaryClaim: metadata.summaryClaim,
    generation,
    receipt,
    executionReceipt,
  })
  const scopeCoverage = metadata.scope ? buildScopeCoverage(metadata.scope) : undefined
  const verifierVerdict = receipt !== undefined
    || (executionReceipt !== undefined && (executionReceipt.status === 'passed' || executionReceipt.status === 'failed'))
  const evidence = evidenceForTrajectory(state, { summaryClaim: metadata.summaryClaim, verificationReceipt: verifierVerdict })
  return {
    ...state,
    ...(evidence.length > 0 ? { evidence } : {}),
    verification,
    ...(scopeCoverage ? { scopeCoverage } : {}),
  } as T
}
