import type { TrajectoryState } from './types.ts'

export const POLICY_ORDER = [
  'failure',
  'first-turn',
  'verification',
  'implementation',
  'exploration',
  'unclassified',
] as const

export type PolicyCondition = (typeof POLICY_ORDER)[number]

const REASONS: Record<PolicyCondition, (state: TrajectoryState) => string> = {
  failure: (state) => `failure evidence: ${state.failureEvidence[0] ?? 'unknown'}`,
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
  options: { exclude?: string[] } = {},
): TierDecision {
  const exclude = new Set(options.exclude ?? [])
  for (const condition of POLICY_ORDER) {
    if (exclude.has(condition)) continue
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
