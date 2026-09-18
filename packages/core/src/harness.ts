import { decideTier } from './policy.ts'
import { classifyRound, detectFailure } from './state.ts'
import type { FailureLevel, RoundKind, TrajectoryState } from './types.ts'

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
  hasTools: boolean
  toolNames: string[]
  calls: HarnessToolCall[]
}

export interface CatalogTier {
  model: string
  effort?: string
  minPlan?: string
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

export function trajectoryFromRound(round: HarnessRound): TrajectoryState {
  const calls = round.calls.map((call) => ({ name: call.name, args: call.args }))
  const outputs = round.calls
    .map((call) => call.output ?? '')
    .filter((output) => output.trim().length > 0)
  const detected = detectFailure(outputs)
  const failed = round.calls.some((call) => call.failed === true)

  // A tool that reports its own failure is ground truth. Text alone never escalates a round,
  // because tool output includes file contents: prose that mentions an error is not an error.
  const failure: FailureLevel = failed ? 'hard' : detected.level === 'soft' ? 'soft' : 'none'
  const failureEvidence = failed
    ? detected.evidence.length > 0
      ? detected.evidence
      : ['tool reported an error']
    : detected.evidence

  return {
    messageCount: round.messageCount,
    assistantTurns: round.assistantTurns,
    toolMessages: round.calls.length,
    lastRole: round.lastRole,
    contextChars: round.contextChars,
    estimatedTokens: Math.ceil(round.contextChars / CHARS_PER_TOKEN),
    hasTools: round.hasTools,
    toolNames: round.toolNames,
    lastToolNames: calls.map((call) => call.name),
    roundKind: roundKindOf(round, calls),
    failure,
    failureEvidence,
  }
}

export function planRound(
  state: TrajectoryState,
  policy: Record<string, string>,
  tiers: Record<string, CatalogTier>,
): RoundPlan | undefined {
  const decision = decideTier(state, policy)
  const tier = tiers[decision.tier]
  if (!tier || !tier.model) return undefined
  return {
    tier: decision.tier,
    model: tier.model,
    effort: tier.effort,
    rule: decision.rule,
    reason: decision.reason,
    state,
  }
}
