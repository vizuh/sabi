import { cheapestServingTier, isEnabledUpstream, servesInputModalities } from './compatibility.ts'
import { decideTier } from './policy.ts'
import { candidateBeatsIncumbent, recoveryRate, type RecoveryProfile } from './recovery.ts'
import { textOf } from './state.ts'
import type { ChatRequestBody, JudgeConfig, JudgeRecord, SabiConfig, RouteDecision } from './types.ts'

export interface JudgeQuestions {
  real_problem: {
    type: 'noul'
    instructions: string
    criteria: { true: string; false: string }
  }
  difficulty: {
    type: 'choice'
    instructions: string
    criteria: Record<string, string>
  }
  evidence_redundant: {
    type: 'noul'
    instructions: string
    criteria: { true: string; false: string }
  }
}

export const JUDGE_QUESTIONS: JudgeQuestions = {
  real_problem: {
    type: 'noul',
    instructions:
      'The coding agent just received the tool result in `last_tool.result_excerpt`. Does it describe a genuine problem the agent must address now (failing tests, real errors, broken build, unexpected failure), rather than an expected or benign outcome?',
    criteria: {
      true: 'A real defect or failure that blocks or degrades the task and should be fixed or investigated',
      false:
        'An expected outcome (for example the user explicitly asked to run something that fails), informational output, a permission prompt or denial from the harness, a provider or subscription limit (rate limit, session/usage/quota limit) that says the provider or the plan was exhausted rather than the task being broken, or a failure unrelated to the task',
    },
  },
  difficulty: {
    type: 'choice',
    instructions:
      "How demanding is the agent's next step, given the state so far? Consider the last instruction, the tool activity, and the trajectory position. A provider or subscription limit in the evidence (rate limit, session/usage/quota limit, too many requests) is not task difficulty — it says the provider or the plan was exhausted, never that the step is demanding.",
    criteria: {
      trivial: 'Mechanical or bookkeeping work — reading, listing, searching, routine follow-ups',
      standard: 'Ordinary implementation, debugging, or verification work',
      demanding:
        'Hard reasoning — architecture, subtle debugging, security review, multi-step planning, or the agent is stuck after repeated failures',
    },
  },
  // Shadow question: it rides the same batched request (no extra call) and is recorded on the
  // decision, but no route, threshold or transcript depends on it yet. Treat it as unverified
  // until it has been measured on real traffic.
  evidence_redundant: {
    type: 'noul',
    instructions:
      'For the next step, is the tool result excerpt in `last_tool.result_excerpt` redundant — already captured elsewhere in this conversation, or cheaply re-obtainable by re-running the tool — so that keeping it verbatim would add no required evidence?',
    criteria: {
      true: 'The facts it carries are already stated elsewhere, or the same call can be re-run at will; a shorter reference would lose nothing the next step needs',
      false: 'It still carries needed evidence — an exact error, a result that changed state, or output that cannot be re-obtained — so the next step depends on it',
    },
  },
}

const DIFFICULTY_TIERS: Record<string, string> = {
  trivial: 'cheap',
  standard: 'mid',
  demanding: 'strong',
}

const TIER_ORDER: Record<string, number> = { cheap: 0, mid: 1, strong: 2 }

export interface JudgeOutcome {
  realProblem?: number
  difficulty?: string
  difficultyConfidence?: number
  /** Shadow question answer, when the service returned one. Never used to route. */
  evidenceRedundant?: number
  model?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export function judgeTriggers(decision: RouteDecision, config: JudgeConfig): boolean {
  if (!config.enabled) return false
  const callOn = config.callOn ?? ['failure', 'unclassified']
  return callOn.includes(decision.rule)
}

function trimmed(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text
}

export function buildJudgeState(
  body: ChatRequestBody,
  decision: RouteDecision,
  maxChars = 6000,
): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user')
  const lastTool = [...messages].reverse().find((message) => message?.role === 'tool')
  let excerpt = trimmed(textOf(lastTool?.content), 2500)
  const build = (): Record<string, unknown> => ({
    round: {
      index: decision.state.assistantTurns,
      kind_heuristic: decision.state.roundKind,
      messages: decision.state.messageCount,
      context_tokens_estimate: decision.state.estimatedTokens,
      // Reaching the request state is what keeps a cached verdict from crossing a rewrite: the
      // cache key is a hash of this object, so a different generation always misses.
      ...(decision.state.contextGeneration ? { context_generation: decision.state.contextGeneration } : {}),
    },
    last_instruction: trimmed(textOf(lastUser?.content), 1200),
    last_tool: {
      names: decision.state.lastToolNames.slice(0, 6),
      result_excerpt: excerpt,
    },
    failure_evidence_heuristic: decision.state.failureEvidence.slice(0, 3),
    available_tools: decision.state.toolNames.slice(0, 40),
  })
  let state = build()
  while (JSON.stringify(state).length > maxChars && excerpt.length > 200) {
    excerpt = excerpt.slice(0, Math.floor(excerpt.length / 2))
    state = build()
  }
  return state
}

export function applyJudge(
  decision: RouteDecision,
  config: SabiConfig,
  outcome: JudgeOutcome,
  profile?: RecoveryProfile,
): { decision: RouteDecision; record: JudgeRecord } {
  const thresholds = config.judge?.thresholds ?? {}
  const realProblemFloor = thresholds.realProblem ?? 0.6
  const vetoFloor = thresholds.veto ?? 0.25
  const difficultyFloor = thresholds.difficultyConfidence ?? 0.6

  let next = decision
  // Set only by the ambiguous-band recovery tie-breaker below. Guards the difficulty block
  // further down: retier() can resolve the fallback rule to 'unclassified', which would
  // otherwise re-trigger that block and silently overwrite this decision.
  let declinedViaRecovery = false
  const record: JudgeRecord = {
    status: 'ok',
    model: outcome.model,
    realProblem: outcome.realProblem,
    difficulty: outcome.difficulty,
    difficultyConfidence: outcome.difficultyConfidence,
    // Shadow only: recorded for measurement. A future context-selection step may consume it;
    // today nothing changes a route, a threshold or the transcript based on this answer.
    evidenceRedundant: outcome.evidenceRedundant,
    originalTier: decision.tier,
    finalTier: decision.tier,
    overridden: false,
    usage: outcome.usage,
  }

  const required = decision.state.inputModalities ?? []
  const servesRound = (tier: string): boolean => {
    const model = config.models[tier]
    return Boolean(model) && isEnabledUpstream(config.upstreams[model!.upstream]) && servesInputModalities(model!.capabilities?.inputModalities, required)
  }

  // A judge verdict is a tier name, not a route: it can still land on a disabled upstream or a
  // tier that cannot serve this round's modality, same as the initial policy decision could. Fall
  // back the same way route() does (cheapest priced tier, ties by name) rather than let a judge
  // override hard-fail at post-judge ensureRouteCompatible revalidation when another tier could
  // actually serve it.
  const retier = (tier: string, rule: string, reason: string): boolean => {
    if (!config.models[tier]) return false
    let resolvedTier = tier
    let resolvedRule = rule
    let resolvedReason = reason
    if (!servesRound(tier)) {
      const alternate = cheapestServingTier(config.models, (name) => servesRound(name))
      if (alternate) {
        resolvedTier = alternate
        resolvedRule = 'availability'
        resolvedReason = `${reason} — but '${tier}' cannot serve this round; '${alternate}' can`
      }
    }
    const model = config.models[resolvedTier]!
    const changed = resolvedTier !== next.tier
    next = { ...next, tier: resolvedTier, rule: resolvedRule, reason: resolvedReason, model: resolvedTier, upstream: model.upstream, upstreamModel: model.model }
    record.finalTier = resolvedTier
    if (changed) {
      record.overridden = true
      record.direction = (TIER_ORDER[resolvedTier] ?? 0) < (TIER_ORDER[decision.tier] ?? 0) ? 'down' : 'up'
    }
    return changed
  }

  if (decision.rule === 'failure' && typeof outcome.realProblem === 'number') {
    if (outcome.realProblem <= vetoFloor) {
      const fallback = decideTier(decision.state, config.policy, { exclude: ['failure'] })
      const changed = retier(
        fallback.tier,
        fallback.rule,
        `jev vetoed escalation (real-problem probability ${outcome.realProblem.toFixed(2)}); ${fallback.reason}`,
      )
      record.note = changed ? 'escalation vetoed' : 'escalation vetoed (no tier change)'
    } else if (outcome.realProblem >= realProblemFloor) {
      record.note = 'escalation confirmed'
    } else {
      // Ambiguous, not confident either way. If a locally-measured recovery rate (this session's
      // own history, gated at a minimum sample size — see recovery.ts) says the deterministic
      // fallback tier credibly recovers at least as often as the incumbent tier does (a
      // non-overlapping-confidence-interval test, not a point-estimate comparison), decline the
      // escalation. This can only fall back to a tier decideTier() itself already proposed —
      // never invents one — and never fires outside this ambiguous band.
      let declineNote: string | undefined
      if (profile) {
        const fallback = decideTier(decision.state, config.policy, { exclude: ['failure'] })
        const incumbentModel = config.models[decision.tier]?.model
        const candidateModel = config.models[fallback.tier]?.model
        const incumbent = incumbentModel ? recoveryRate(profile, decision.tier, incumbentModel) : undefined
        const candidate = candidateModel ? recoveryRate(profile, fallback.tier, candidateModel) : undefined
        if (candidateBeatsIncumbent(candidate, incumbent)) {
          const changed = retier(
            fallback.tier,
            fallback.rule,
            `local recovery rate favors '${fallback.tier}' over '${decision.tier}' (${fallback.reason})`,
          )
          // retier() can itself fall further back to a capability/availability substitute if the
          // proposed fallback tier can't serve this round. Only claim a decline when what
          // actually served is no stronger than the incumbent — otherwise this tie-breaker would
          // silently stop being decline-only/one-directional in that edge case.
          if (changed && (TIER_ORDER[next.tier] ?? 0) <= (TIER_ORDER[decision.tier] ?? 0)) {
            declineNote = `ambiguous; declined via local recovery rate (n=${candidate!.eligible}/${incumbent!.eligible})`
            declinedViaRecovery = true
          } else if (changed) {
            declineNote = `ambiguous; local recovery favored a tier unavailable for this round, kept a different substitute (${next.rule})`
          }
        }
      }
      record.note = declineNote ?? 'ambiguous; deterministic escalation kept'
    }
  }

  if (next.rule === 'unclassified' && typeof outcome.difficulty === 'string' && !declinedViaRecovery) {
    const confidence = outcome.difficultyConfidence ?? 0
    const tier = DIFFICULTY_TIERS[outcome.difficulty]
    if (tier && config.models[tier] && confidence >= difficultyFloor) {
      const changed = retier(tier, 'unclassified', `jev difficulty=${outcome.difficulty} (confidence ${confidence.toFixed(2)})`)
      record.note = `${changed ? 'difficulty override' : 'difficulty confirmed'}: ${outcome.difficulty}`
    } else if (!record.note) {
      record.note = `difficulty below threshold (${confidence.toFixed(2)})`
    }
  }

  return { decision: next, record }
}
