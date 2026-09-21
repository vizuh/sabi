/**
 * Deterministic signal producers (Phase 1: shadow only, no routing).
 *
 * Each producer translates one ground truth the code already owns into a
 * DecisionSignal at confidence 1.0. Fuzzy judgments (text-derived failures
 * without tool confirmation, ambiguity, retry worth, coverage) are deliberately
 * absent here — they belong to the batched Jev call in Phase 2. A missing
 * signal means "not observed", never "false".
 *
 * Ground-truth rules, mirrored from the existing pipeline:
 * - `failure.transport` tracks `state.failure`: the classifier already separates
 *   transport (rate-limit/quota/timeout/plan walls) from task failure.
 * - `failure.real` fires only on `tool-error` evidence (the tool's own `isError`
 *   is authoritative; prose that mentions an error is not an error) and on an
 *   explicitly clean round. Anything in between stays absent for Jev.
 * - `progress.stalled` tracks `repeatedFailure` (same signature twice).
 * - `verification.complete` tracks verification rounds and their outcome.
 * - `context.pressure` is the measured tokens/window ratio, clamped 0..1.
 * - `context.staleness` tracks an observed host rewrite (`contextGeneration`).
 *
 * Signal ids are `${kind}:${roundId ?? 'live'}` so recomputing a judgment for
 * the same round overwrites rather than duplicates. Time is injected.
 */
import {
  MAX_SIGNAL_AGE_MS,
  type DecisionSignal,
  type EvidenceRef,
  type SignalKind,
} from './signals.ts'
import type { TrajectoryState } from './types.ts'

export interface SignalScope {
  sessionId: string
  operationId?: string
  roundId?: string
  observedAt: number
}

function refs(codes: readonly string[]): EvidenceRef[] {
  return codes.slice(0, 8).map((code) => ({ kind: 'failure-evidence', id: code }))
}

function base(
  kind: SignalKind,
  value: boolean | number,
  scope: SignalScope,
  evidence: EvidenceRef[] = [],
): DecisionSignal {
  return {
    id: `${kind}:${scope.roundId ?? 'live'}`,
    kind,
    value,
    confidence: 1,
    sessionId: scope.sessionId,
    ...(scope.operationId ? { operationId: scope.operationId } : {}),
    ...(scope.roundId ? { roundId: scope.roundId } : {}),
    source: 'deterministic',
    evidence,
    observedAt: scope.observedAt,
    expiresAt: scope.observedAt + MAX_SIGNAL_AGE_MS,
    mode: 'shadow',
  }
}

/**
 * Emit every deterministic signal observable from this trajectory state.
 * Pure: same state and scope always yield the same signals. Routing is
 * untouched — consumers must treat these as shadow until Phase 4.
 */
export function deterministicSignals(state: TrajectoryState, scope: SignalScope): DecisionSignal[] {
  const signals: DecisionSignal[] = []
  signals.push(
    base('failure.transport', state.failure === 'transport', scope, refs(state.failureEvidence)),
  )
  const toolConfirmed = state.failureEvidence.includes('tool-error')
  if (toolConfirmed) {
    signals.push(base('failure.real', true, scope, refs(state.failureEvidence)))
  } else if (state.failure === 'none') {
    signals.push(base('failure.real', false, scope, refs(state.failureEvidence)))
  }
  if (state.repeatedFailure === true) {
    signals.push(base('progress.stalled', true, scope, [{ kind: 'failure-evidence', id: 'prior-failure' }]))
  }
  if (state.roundKind === 'verification') {
    signals.push(base('verification.complete', state.failure === 'none', scope, refs(state.failureEvidence)))
  }
  if (
    state.contextTokens !== undefined &&
    state.contextWindow !== undefined &&
    state.contextWindow > 0
  ) {
    const ratio = state.contextTokens / state.contextWindow
    signals.push(
      base('context.pressure', Math.min(1, Math.max(0, ratio)), scope, [
        { kind: 'context-boundary', id: 'window-ratio' },
      ]),
    )
  }
  if (state.contextGeneration !== undefined && state.contextGeneration > 0) {
    signals.push(base('context.staleness', true, scope, [{ kind: 'context-boundary', id: 'rewrite-observed' }]))
  }
  return signals
}

export function signalByKind(signals: readonly DecisionSignal[], kind: SignalKind): DecisionSignal | undefined {
  return signals.find((signal) => signal.kind === kind)
}
