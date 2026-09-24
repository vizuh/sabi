import type {
  CandidateRoute,
  DecisionRecord,
  ProposedRoute,
  ShadowRecord,
  TrajectoryState,
} from './types.ts'

export interface ShadowRecordInput {
  decision: DecisionRecord
  proposed: ProposedRoute[]
  candidates: CandidateRoute[]
  state: TrajectoryState
  /** Optional mirror mode tag; defaults to 'shadow'. */
  mode?: 'shadow' | 'backtested'
}

const SECRET_KEYS = new Set<string>(['apiKey', 'token', 'secret', 'password', 'authorization'])

/**
 * Build one shadow mirror record for a routed round.
 *
 * The mirror observes Sabi's own decision and the candidate set it considered;
 * it never intercepts, reroutes, or influences execution. Divergence between
 * the actual route and a proposed route is flagged with a reason, never
 * silently absorbed — that is the whole point of mirroring.
 */
export function buildShadowRecord(input: ShadowRecordInput): ShadowRecord {
  const actual: ProposedRoute = {
    tier: input.decision.tier,
    upstream: input.decision.upstream,
    upstreamModel: input.decision.upstreamModel,
  }
  const proposed = input.proposed.map((route) => ({ ...route }))
  const candidates = input.candidates.map((route) => ({ ...route }))

  let divergence: ShadowRecord['divergence'] = 'none'
  let divergenceReason: string | undefined
  if (proposed.length === 0) {
    divergence = 'no-proposal'
  } else if (proposed[0].tier !== actual.tier) {
    divergence = 'proposed-differs'
    divergenceReason = `proposed tier '${proposed[0].tier}' differs from actual tier '${actual.tier}'`
  }

  return {
    kind: 'shadow',
    ts: input.decision.ts,
    sessionId: input.decision.sessionId,
    mode: input.mode ?? 'shadow',
    actual,
    proposed,
    candidates,
    divergence,
    divergenceReason,
    state: input.state,
    rule: input.decision.rule,
    tier: input.decision.tier,
    outcome: input.decision.outcome,
  }
}

/** Flag divergence between an actual route and a proposed route. */
export function divergenceReason(
  actualTier: string,
  proposed: ProposedRoute[],
): string | undefined {
  if (proposed.length === 0) return undefined
  if (proposed[0].tier === actualTier) return undefined
  return `proposed tier '${proposed[0].tier}' differs from actual tier '${actualTier}'`
}

/** Type guard for mirror records. */
export function isShadowRecord(value: unknown): value is ShadowRecord {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'shadow'
}

/**
 * Write-time sanitizer. Secret-like keys are dropped before anything reaches
 * the mirror store; the mirror never carries credentials, raw prompts or
 * unbounded excerpts.
 */
export function sanitizeShadowRecord(record: ShadowRecord): ShadowRecord {
  const serialized = JSON.stringify(record, (_, value) => {
    if (value && typeof value === 'object') {
      for (const key of SECRET_KEYS) {
        if (key in value) delete (value as Record<string, unknown>)[key]
      }
    }
    return value
  })
  return JSON.parse(serialized) as ShadowRecord
}