import type { TrajectoryState } from './types.ts'

export const POLICY_ORDER = [
  'stuck',
  'failure',
  'context-pressure',
  'transport',
  'first-turn',
  'verification',
  'implementation',
  'exploration',
  'unclassified',
] as const

export type PolicyCondition = (typeof POLICY_ORDER)[number]

const REASONS: Record<PolicyCondition, (state: TrajectoryState) => string> = {
  failure: (state) => `failure evidence: ${state.failureEvidence[0] ?? 'unknown'}`,
  stuck: (state) => `repeated failure (streak ${state.failureStreak ?? 2}); investigate instead of escalating more`,
  'context-pressure': (state) =>
    `context ${state.contextTokens ?? state.estimatedTokens} tokens vs window ${state.contextWindow ?? 'unknown'}; prefer a big-window model`,
  transport: (state) =>
    `transport error (${state.failureEvidence[0] ?? 'rate-limited'}), not a reasoning failure — retry, do not escalate`,
  'first-turn': (state) =>
    state.assistantTurns === 0 ? 'new session, no prior turns' : 'new user instruction',
  verification: () => 'verification round (tests/build/check)',
  implementation: () => 'implementation round (edits)',
  exploration: () => 'exploration round (read/search/bookkeeping)',
  unclassified: () => 'unclassified round',
}

export function matches(condition: PolicyCondition, state: TrajectoryState): boolean {
  switch (condition) {
    case 'failure':
      return state.failure === 'hard'
    case 'stuck':
      return state.repeatedFailure === true
    case 'context-pressure':
      return state.contextTokens !== undefined && state.contextWindow !== undefined && state.contextTokens > 0.9 * state.contextWindow
    case 'transport':
      return state.failure === 'transport'
    case 'first-turn':
      return state.roundKind === 'first-turn'
    case 'verification':
      return state.roundKind === 'verification'
    case 'implementation':
      return state.roundKind === 'implementation'
    case 'exploration':
      return state.roundKind === 'exploration'
    case 'unclassified':
      return state.roundKind === 'unclassified'
  }
}

export interface TierDecision {
  rule: string
  tier: string
  reason: string
}

export function decideTier(
  state: TrajectoryState,
  policy: Record<string, string>,
  options: {
    exclude?: string[]
    /** Tier to force when a repeated-failure (stuck) condition fires, if one is configured. */
    stuckTier?: string
  } = {},
): TierDecision {
  const exclude = new Set(options.exclude ?? [])
  for (const condition of POLICY_ORDER) {
    if (exclude.has(condition)) continue
    if (condition === 'stuck') {
      // Repeated failures trigger investigation, not endless escalation. If a stuck tier is
      // configured, use it and stay there; otherwise skip the rule entirely.
      if (state.repeatedFailure === true) {
        const tier = options.stuckTier && options.stuckTier !== 'off' ? options.stuckTier : policy.stuck
        if (tier && tier !== 'off') {
          return { rule: 'stuck', tier, reason: REASONS.stuck(state) }
        }
      }
      continue
    }
    const tier = policy[condition]
    if (!tier || tier === 'off') continue
    if (matches(condition, state)) {
      return { rule: condition, tier, reason: REASONS[condition](state) }
    }
  }
  const fallback = policy.unclassified
  return {
    rule: 'fallback',
    tier: fallback && fallback !== 'off' ? fallback : 'cheap',
    reason: 'no policy rule matched; fallback tier',
  }
}

/** Suggest a resolving tier for a state, ignoring the configured policy map (used by the mod for a stuck tier). */
export function suggestTier(state: TrajectoryState, tiers: Record<string, string>): string | undefined {
  if (state.repeatedFailure === true) return tiers.stuck
  if (state.failure === 'hard') return tiers.failure
  if (state.roundKind === 'first-turn') return tiers['first-turn']
  if (state.roundKind === 'verification') return tiers.verification
  if (state.roundKind === 'implementation') return tiers.implementation
  if (state.roundKind === 'exploration') return tiers.exploration
  return tiers.unclassified
}
