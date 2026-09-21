import { firstServingTier, servesInputModalities } from './compatibility.ts'
import { decorateTrajectoryState } from './evidence.ts'
import { decideTier } from './policy.ts'
import { CHARS_PER_TOKEN, classifyRound, detectFailure, mediaTokens, modalitiesOf } from './state.ts'
import type { CatalogTier, FailureLevel, ModelModality, RoundKind, ScopeInput, TrajectoryState, VerificationReceipt } from './types.ts'

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
  /** Host compactions observed before this round, when the harness can see them. */
  contextGeneration?: number
  hasTools: boolean
  toolNames: string[]
  calls: HarnessToolCall[]
  /**
   * Modalities the harness found in the conversation. Absent means "not observed", which leaves the
   * plan unconstrained — a harness can only report positive evidence about content it can read.
   */
  inputModalities?: ModelModality[]
  mediaCounts?: Partial<Record<Exclude<ModelModality, 'text'>, number>>
  verificationReceipt?: VerificationReceipt
  summaryClaim?: boolean
  scope?: ScopeInput
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

  const contextTokens = round.contextTokens ?? Math.ceil(round.contextChars / CHARS_PER_TOKEN) + mediaTokens(roundMedia(round))

  // Repeated-failure heuristic: the *same* failure signature (hard failure matching the
  // previous round's hard failure) is what triggers investigation, not just two failures.
  const sameFailure = previous?.failure === 'hard' && failure === 'hard'
  const repeatedFailure = sameFailure === true
  const failureStreak = repeatedFailure ? 2 : failure === 'hard' ? 1 : 0

  const state: TrajectoryState = {
    messageCount: round.messageCount,
    assistantTurns: round.assistantTurns,
    toolMessages: round.calls.length,
    lastRole: round.lastRole,
    contextChars: round.contextChars,
    estimatedTokens: Math.ceil(round.contextChars / CHARS_PER_TOKEN) + mediaTokens(roundMedia(round)),
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
    ...(round.contextGeneration ? { contextGeneration: round.contextGeneration } : {}),
    ...(round.inputModalities ? { inputModalities: round.inputModalities } : {}),
    ...(round.mediaCounts && Object.keys(round.mediaCounts).length
      ? { inputModalities: round.inputModalities ?? modalitiesOf(round.mediaCounts), mediaCounts: round.mediaCounts }
      : {}),
  }
  return decorateTrajectoryState(state, {
    generation: round.contextGeneration,
    verificationReceipt: round.verificationReceipt,
    summaryClaim: round.summaryClaim,
    scope: round.scope,
  })
}

function roundMedia(round: HarnessRound): { counts: Partial<Record<Exclude<ModelModality, 'text'>, number>>; payloadChars: number } {
  // A harness reports what it saw, never payload sizes: images are charged the per-image bound and
  // no other media is charged, rather than guessing a byte count the harness never measured.
  return { counts: round.mediaCounts ?? {}, payloadChars: 0 }
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
  const required = withWindow.inputModalities ?? []
  let tier = decision.tier
  let rule = decision.rule
  let reason = decision.reason
  const planned = tiers[tier]
  if (planned && !servesInputModalities(planned.inputModalities, required)) {
    const alternate = firstServingTier(tiers, required, (entry) => entry.inputModalities)
    // With no tier that can accept the input, plan nothing and leave the round on the session
    // model: the host strips media for a text-only model, so routing there would answer blind.
    if (!alternate) return undefined
    reason = `input needs ${required.join('+')}; '${tier}' (${planned.model}) cannot accept it, '${alternate}' can`
    rule = 'capability'
    tier = alternate
  }
  const chosen = tiers[tier]
  if (!chosen || !chosen.model) return undefined
  return {
    tier,
    model: chosen.model,
    effort: chosen.effort,
    rule,
    reason,
    state: withWindow,
  }
}
