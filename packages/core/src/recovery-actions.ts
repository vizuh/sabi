import { isFullyVerified } from './evidence.ts'
import type {
  RecoveryAction,
  RecoveryPlan,
  RecoveryPlannerInput,
  RecoveryReasonCode,
  TrajectoryState,
} from './types.ts'

export const RECOVERY_ACTIONS: readonly RecoveryAction[] = [
  'continue',
  'retry-same',
  'retry-with-feedback',
  'gather-evidence',
  'escalate-model',
  'fresh-context',
  'rollback-with-reflection',
  'ask-user',
]

export const RECOVERY_REASON_CODES: readonly RecoveryReasonCode[] = [
  'none',
  'transport',
  'hard-failure',
  'missing-evidence',
  'repeated-failure',
  'user-denial',
  'invalid-receipt',
  'exhausted-routes',
  'unsupported-capability',
  'stale-generation',
  'no-safe-continuation',
  'verified',
]

export function isRecoveryAction(value: unknown): value is RecoveryAction {
  return typeof value === 'string' && (RECOVERY_ACTIONS as readonly string[]).includes(value)
}

export function isRecoveryReasonCode(value: unknown): value is RecoveryReasonCode {
  return typeof value === 'string' && (RECOVERY_REASON_CODES as readonly string[]).includes(value)
}

export function normalizeRecoveryAction(value: unknown, fallback: RecoveryAction = 'ask-user'): RecoveryAction {
  return isRecoveryAction(value) ? value : fallback
}

function plan(action: RecoveryAction, reason: RecoveryReasonCode, input: RecoveryPlannerInput, retryable = false): RecoveryPlan {
  const constraints = input.currentRoute || input.currentProvider
    ? {
        ...(input.currentRoute ? { excludeRoutes: [input.currentRoute] } : {}),
        ...(input.currentProvider ? { excludeProviders: [input.currentProvider] } : {}),
      }
    : undefined
  return {
    action,
    reason,
    retryable,
    source: 'deterministic',
    ...(constraints ? { constraints } : {}),
  }
}

/**
 * Deterministic intervention selection. Model/tier selection happens after this result and must
 * still pass the existing capability and availability gates.
 */
export function planRecovery(input: RecoveryPlannerInput): RecoveryPlan {
  const state = input.state
  const verification = input.verification ?? state.verification
  const evidence = new Set(state.failureEvidence)
  const hasRoutes = input.availableRoutes === undefined || input.availableRoutes.length > 0
  const retriesRemaining = input.retriesRemaining ?? 1

  // Hard user/capability/receipt gates always win over model preference.
  if (input.userDenied || evidence.has('permission-denial')) return plan('ask-user', 'user-denial', input)
  if (input.invalidReceipt || verification?.reason === 'invalid-receipt') return plan('ask-user', 'invalid-receipt', input)
  if (input.unsupportedCapability) return plan('ask-user', 'unsupported-capability', input)
  if (input.exhaustedRoutes || !hasRoutes) return plan('ask-user', 'exhausted-routes', input)

  if (state.failure === 'transport') {
    // A transport failure is not reasoning difficulty. Keep the intervention a retry while
    // excluding the unavailable route/provider from the next selection.
    return plan('retry-same', 'transport', input, retriesRemaining > 0)
  }

  if (verification?.status === 'unknown' || verification?.status === 'needed' || verification?.status === 'attempted') {
    return plan('gather-evidence', verification.reason === 'stale-generation' ? 'stale-generation' : 'missing-evidence', input)
  }

  if (state.repeatedFailure === true || (state.failureStreak ?? 0) >= 2) {
    return input.safeRollback
      ? plan('rollback-with-reflection', 'repeated-failure', input)
      : plan('fresh-context', 'repeated-failure', input)
  }

  if (state.failure === 'hard') {
    if (verification?.status === 'failed' || input.hasFeedback) return plan('retry-with-feedback', 'hard-failure', input, retriesRemaining > 0)
    return plan('escalate-model', 'hard-failure', input, false)
  }

  if (verification && isFullyVerified(verification, state.scopeCoverage, state.contextGeneration)) {
    return plan('continue', 'verified', input)
  }
  return plan('continue', 'none', input)
}

/** A judge may suggest an action, but malformed or non-allowlisted output never crosses the gate. */
export function recoveryPlanFromCandidate(candidate: unknown, fallback: RecoveryPlan): RecoveryPlan {
  if (isRecoveryAction(candidate)) {
    return {
      action: candidate,
      reason: fallback.reason,
      retryable: candidate === 'retry-same' || candidate === 'retry-with-feedback',
      source: 'judge',
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return fallback
  const value = candidate as Record<string, unknown>
  if (!isRecoveryAction(value.action)) return fallback
  return {
    action: value.action,
    reason: isRecoveryReasonCode(value.reason) ? value.reason : fallback.reason,
    retryable: value.action === 'retry-same' || value.action === 'retry-with-feedback',
    source: 'judge',
  }
}

export function stateForRecovery(state: TrajectoryState, input: Omit<RecoveryPlannerInput, 'state'> = {}): RecoveryPlan {
  return planRecovery({ ...input, state })
}
