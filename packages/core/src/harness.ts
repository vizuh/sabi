import { decideTier } from './policy.ts'
import { classifyRound, detectFailure } from './state.ts'
import type { CatalogTier, FailureLevel, RoundKind, TrajectoryState } from './types.ts'

const CHARS_PER_TOKEN = 3.6

export interface HarnessToolCall {
  name: string
  args?: string
  failed?: boolean
  output?: string
}

export interface HarnessRound {
  messageCount: number
  assistantTurns: number
  lastRole: string
  contextChars: number
  contextTokens?: number
  hasTools: boolean
  toolNames: string[]
  calls: HarnessToolCall[]
}

export interface RoundPlan {
  tier: string
  model: string
  effort?: string
  rule: string
  reason: string
  state: TrajectoryState
}

function roundKindOf(round: HarnessRound, calls: Array<{ name: string; args?: string }>): RoundKind {
  if (round.assistantTurns === 0 || round.lastRole === 'user') return 'first-turn'
  if (round.lastRole === 'tool') return classifyRound(calls)
  return 'unclassified'
}

export function trajectoryFromRound(
  round: HarnessRound,
  previous?: Pick<TrajectoryState, 'failure' | 'failureEvidence'>,
): TrajectoryState {
  const calls = round.calls.map((call) => ({ name: call.name, args: call.args }))
  const outputs = round.calls
    .map((call) => call.output ?? '')
    .filter((output) => output.trim().length > 0)
  const detected = detectFailure(outputs)
  const failed = round.calls.some((call) => call.failed === true)

  // A tool that reports its own failure is ground truth. Text alone never escalates a round,
  // because tool output includes file contents: prose that mentions an error is not an error.
  // A transport signal (429/rate-limit/timeout) is not a task failure — retry, don't escalate.
  const failure: FailureLevel =
    failed
      ? detected.level === 'transport'
        ? 'transport'
        : 'hard'
      : detected.level === 'soft'
        ? 'soft'
        : 'none'
  const failureEvidence = failed
    ? detected.evidence.length > 0
      ? detected.evidence
      : ['tool-error']
    : detected.evidence

  const contextTokens = round.contextTokens ?? Math.ceil(round.contextChars / CHARS_PER_TOKEN)

  // Repeated-failure heuristic: the *same* failure signature (hard failure matching the
  // previous round's hard failure) is what triggers investigation, not just two failures.
  const sameFailure = previous?.failure === 'hard' && failure === 'hard'
  const repeatedFailure = sameFailure === true
  const failureStreak = repeatedFailure ? 2 : failure === 'hard' ? 1 : 0

  return {
    messageCount: round.messageCount,
    assistantTurns: round.assistantTurns,
    toolMessages: round.calls.length,
    lastRole: round.lastRole,
    contextChars: round.contextChars,
    estimatedTokens: Math.ceil(round.contextChars / CHARS_PER_TOKEN),
    contextTokens,
    contextKnown: true,
    hasTools: round.hasTools,
    toolNames: round.toolNames,
    lastToolNames: calls.map((call) => call.name),
    roundKind: roundKindOf(round, calls),
    failure,
    failureEvidence,
    repeatedFailure,
    failureStreak,
  }
}

export function planRound(
  state: TrajectoryState,
  policy: Record<string, string>,
  tiers: Record<string, CatalogTier>,
  options: { previous?: Pick<TrajectoryState, 'failure' | 'failureEvidence'>; contextWindow?: number } = {},
): RoundPlan | undefined {
  const withWindow =
    options.contextWindow !== undefined && state.contextWindow === undefined ? { ...state, contextWindow: options.contextWindow } : state
  const decision = decideTier(withWindow, policy, { stuckTier: policy.stuck })
  const tier = tiers[decision.tier]
  if (!tier || !tier.model) return undefined
  return {
    tier: decision.tier,
    model: tier.model,
    effort: tier.effort,
    rule: decision.rule,
    reason: decision.reason,
    state: withWindow,
  }
}
