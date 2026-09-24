import { createHash } from 'node:crypto'
import type {
  AdapterKind,
  AdapterRefusal,
  ContinuityLock,
  DecisionEnvelope,
  RecoveryAction,
  RecoveryReasonCode,
  RouteDecision,
  SabiConfig,
} from './types.ts'

export interface HostCapabilities {
  effort?: boolean
  modelSwitch?: boolean
  reasoning?: boolean
}

export interface DecisionEnvelopeInput {
  decision: RouteDecision
  config: SabiConfig
  hostCapabilities?: HostCapabilities
  hostId: AdapterKind
  requestedEffort?: string
  deadlineMs?: number
  lock?: ContinuityLock
}

const FALLBACK_ORDER: readonly RecoveryAction[] = [
  'escalate-model',
  'retry-same',
  'retry-with-feedback',
  'gather-evidence',
  'verify-local',
  'fresh-context',
  'rollback-with-reflection',
  'ask-user',
  'switch-harness',
  'rollback',
  'continue',
]

/**
 * Deterministic fallback chain for a recovery action. Derived, never generated:
 * the fixed order Sabi falls back through when the primary action is unavailable.
 */
export function fallbackFor(action: RecoveryAction): RecoveryAction[] {
  const index = FALLBACK_ORDER.indexOf(action)
  if (index < 0) return []
  return FALLBACK_ORDER.filter((candidate) => candidate !== action)
}

/**
 * Render one Decision envelope for a planned round.
 *
 * The envelope is the symmetric output of the Trajectory IR: one contract every
 * host consumes instead of N bespoke decision shapes. Fields a host cannot
 * express are refused with a reason and recorded in `refused` — the remainder
 * of the decision still applies, so a refusal never silently drops the whole
 * envelope. An undeclared capability reads as all-unknown, never as permissive.
 */
export function renderDecisionEnvelope(input: DecisionEnvelopeInput): DecisionEnvelope {
  const { decision, hostCapabilities, hostId, requestedEffort, deadlineMs, lock } = input
  const refusals: AdapterRefusal[] = []

  // A capability the host has not explicitly declared is unknown, not enabled.
  const hostDeclaresEffort = hostCapabilities?.effort === true
  const hostDeclaresModelSwitch = hostCapabilities?.modelSwitch === true

  // Effort is record-only today: Sabi never injects reasoning controls. A host
  // that cannot express the requested effort refuses that field explicitly.
  if (requestedEffort && !hostDeclaresEffort) {
    refusals.push({
      surface: 'effort',
      reason: `host '${hostId}' has not declared effort support; requested effort '${requestedEffort}' refused, remainder applied`,
    })
  }

  // A model switch the host cannot perform is refused and the current model is
  // retained rather than silently switched.
  if (!hostDeclaresModelSwitch) {
    refusals.push({
      surface: 'modelSwitch',
      reason: `host '${hostId}' has not declared model switch support; current model retained`,
    })
  }

  const envelopeId = createHash('sha256')
    .update(`${hostId}:${decision.tier}:${decision.upstreamModel}:${decision.reason}`)
    .digest('hex')
    .slice(0, 16)

  const recovery = decision.recovery
  const action: RecoveryAction = recovery?.action ?? 'continue'
  const reasonCode: RecoveryReasonCode = recovery?.reason ?? 'none'

  return {
    envelopeId,
    roundId: decision.state.contextGeneration != null
      ? `gen-${decision.state.contextGeneration}`
      : `${hostId}:${decision.tier}`,
    harness: hostId,
    action,
    reasonCode,
    fallback: fallbackFor(action),
    model: decision.upstreamModel,
    upstream: decision.upstream,
    effort: requestedEffort && hostDeclaresEffort ? requestedEffort : undefined,
    deadlineMs,
    lock: lock ?? 'none',
    verification: undefined,
    capabilities: undefined,
    refused: refusals.length ? refusals[0] : undefined,
  }
}