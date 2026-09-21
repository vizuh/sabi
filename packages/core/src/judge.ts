import { createHash } from 'node:crypto'
import { cheapestServingTier, isEnabledUpstream, servesInputModalities } from './compatibility.ts'
import { planRecovery, recoveryPlanFromCandidate } from './recovery-actions.ts'
import { decideTier } from './policy.ts'
import { hashIdentity } from './log.ts'
import { candidateBeatsIncumbent, recoveryRate, type RecoveryProfile } from './recovery.ts'
import { textOf } from './state.ts'
import { looksLikeCanary } from './telemetry.ts'
import type {
  ChatRequestBody,
  EvidenceSource,
  JudgeConfig,
  JudgeEvidence,
  JudgeEvidenceSlotName,
  JudgeEvidenceValue,
  JudgeRecord,
  RecoveryAction,
  SabiConfig,
  RouteDecision,
} from './types.ts'

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
  /** Optional action suggestion; runtime validation keeps it inside the allowlist. */
  recoveryAction?: RecoveryAction | string
}

export function judgeTriggers(decision: RouteDecision, config: JudgeConfig): boolean {
  if (!config.enabled) return false
  if (decision.state.failure === 'transport' || decision.state.failureEvidence.includes('permission-denial')) return false
  if (decision.state.verification?.reason === 'invalid-receipt') return false
  if (decision.recovery?.action === 'ask-user') return false
  const callOn = config.callOn ?? ['failure', 'unclassified']
  return callOn.includes(decision.rule)
}

function trimmed(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text
}

/**
 * Which egress switch governs raw judge content. The judge endpoint is an explicit
 * off-machine surface: raw instruction/tool text leaves only when the operator opts
 * in via `judge.includeSnippets` (preferred) or the shared `telemetry.captureSnippets`.
 * The default is content-free — hashed tool identity, evidence codes and shape only.
 */
export interface JudgeEgress {
  captureSnippets?: boolean
  includeSnippets?: boolean
}

function judgeAllowsSnippets(egress?: JudgeEgress): boolean {
  return egress?.includeSnippets === true || egress?.captureSnippets === true
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const JUDGE_SLOTS: readonly JudgeEvidenceSlotName[] = ['intent', 'mutation', 'failure', 'verification', 'constraint', 'priorFailure', 'contextBoundary']

function unknownEvidence(): JudgeEvidenceValue {
  return { status: 'unknown' }
}

function evidenceValue(
  value: unknown,
  source: EvidenceSource,
  status: JudgeEvidenceValue['status'],
  generation?: number,
  limit = 800,
  includeValue = false,
): JudgeEvidenceValue {
  if (typeof value !== 'string') return unknownEvidence()
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!clean || looksLikeCanary(clean)) return unknownEvidence()
  return {
    ...(includeValue ? { value: trimmed(clean, limit) } : {}),
    source,
    status,
    ...(generation !== undefined ? { contextGeneration: generation } : {}),
  }
}

function verificationEvidence(decision: RouteDecision, includeValue: boolean): JudgeEvidenceValue {
  const verification = decision.state.verification
  if (!verification || verification.status === 'not-required') return unknownEvidence()
  const status = verification.status === 'passed' || verification.status === 'failed' ? 'verified' : verification.status === 'unknown' ? 'unknown' : 'observed'
  return evidenceValue(
    [verification.status, verification.reason, verification.receiptId].filter(Boolean).join(': '),
    verification.receiptId ? 'harness' : 'summary',
    status,
    verification.generation,
    180,
    includeValue,
  )
}

/** Build bounded, state-conditioned evidence. Raw values are opt-in with the same egress gate as snippets. */
export function buildJudgeEvidence(body: ChatRequestBody, decision: RouteDecision, maxChars = 2_400, egress?: JudgeEgress): JudgeEvidence {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user')
  const generation = decision.state.contextGeneration
  const includeValue = judgeAllowsSnippets(egress)
  const mutationTools = new Set(['edit_file', 'write_file', 'edit', 'write', 'apply_patch'])
  const historicalMutations = messages
    .filter((message) => message?.role === 'assistant')
    .flatMap((message) => message.tool_calls ?? [])
    .map((call) => String(call?.function?.name ?? ''))
    .filter((name) => mutationTools.has(name))
  const evidence: JudgeEvidence = {
    intent: evidenceValue(textOf(lastUser?.content), 'user', 'observed', generation, 800, includeValue),
    mutation: decision.state.roundKind === 'implementation' || historicalMutations.length > 0
      ? evidenceValue([...new Set([...historicalMutations, ...decision.state.lastToolNames].filter((name) => mutationTools.has(name)))].join(', '), 'tool', 'observed', generation, 180, includeValue)
      : unknownEvidence(),
    failure: decision.state.failureEvidence.length > 0
      ? evidenceValue(decision.state.failureEvidence.slice(0, 4).join(', '), 'tool', 'observed', generation, 180, includeValue)
      : unknownEvidence(),
    verification: verificationEvidence(decision, includeValue),
    constraint: decision.state.scopeCoverage && ((decision.state.scopeCoverage.missing?.length ?? 0) > 0 || (decision.state.scopeCoverage.expected !== undefined && (decision.state.scopeCoverage.ratio ?? 0) < 1))
      ? evidenceValue(`scope ${decision.state.scopeCoverage.observed ?? 0}/${decision.state.scopeCoverage.expected ?? '?'}`, 'harness', 'observed', generation, 280, includeValue)
      : unknownEvidence(),
    priorFailure: decision.state.repeatedFailure === true || (decision.state.failureStreak ?? 0) > 1
      ? evidenceValue(`streak ${decision.state.failureStreak ?? 2}: ${decision.state.failureEvidence.slice(0, 2).join(', ')}`, 'tool', 'observed', generation, 240, includeValue)
      : unknownEvidence(),
    contextBoundary: generation !== undefined
      ? evidenceValue(String(generation), 'harness', 'observed', generation, 32, includeValue)
      : unknownEvidence(),
    omitted: [],
  }
  const encoded = (): string => JSON.stringify(evidence)
  for (const slot of JUDGE_SLOTS) {
    if (evidence[slot].status === 'unknown' || !evidence[slot].value) evidence.omitted.push(slot)
  }
  while (encoded().length > maxChars) {
    const slot = JUDGE_SLOTS.find((candidate) => Boolean(evidence[candidate].value && evidence[candidate].value!.length > 80))
    if (!slot) break
    const item = evidence[slot]
    item.value = item.value!.slice(0, Math.max(80, Math.floor(item.value!.length / 2)))
  }
  if (encoded().length > maxChars) {
    for (const slot of JUDGE_SLOTS) {
      if (encoded().length <= maxChars) break
      if (evidence[slot].value) {
        evidence[slot] = unknownEvidence()
        if (!evidence.omitted.includes(slot)) evidence.omitted.push(slot)
      }
    }
  }
  return evidence
}

export function buildJudgeState(
  body: ChatRequestBody,
  decision: RouteDecision,
  maxChars = 6000,
  egress?: JudgeEgress,
): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user')
  const lastTool = [...messages].reverse().find((message) => message?.role === 'tool')
  const allowSnippets = judgeAllowsSnippets(egress)
  const rawInstruction = trimmed(textOf(lastUser?.content), 1200)
  const rawExcerpt = trimmed(textOf(lastTool?.content), 2500)
  let excerpt = rawExcerpt
  // Tool names can carry arbitrary private text; the decision log already hashes them
  // (server.ts saveDecision) and the judge state must keep the same invariant.
  const hashedLastTools = decision.state.lastToolNames.slice(0, 6).map((name) => hashIdentity('tool', name))
  const hashedAvailable = decision.state.toolNames.slice(0, 40).map((name) => hashIdentity('tool', name))
  let evidence = buildJudgeEvidence(body, decision, Math.max(800, Math.floor(maxChars / 2)), egress)
  const build = (): Record<string, unknown> => ({
    round: {
      index: decision.state.assistantTurns,
      kind_heuristic: decision.state.roundKind,
      messages: decision.state.messageCount,
      context_tokens_estimate: decision.state.estimatedTokens,
      // The generation is always present (0 for unattributed requests) so the cache key
      // shape is stable; only an identified session can advance it across a host rewrite.
      // Without `x-sabi-session` there is no continuity to invalidate — documented, not guessed.
      context_generation: decision.state.contextGeneration ?? 0,
    },
    ...(allowSnippets
      ? {
          last_instruction: rawInstruction,
          last_tool: {
            names: decision.state.lastToolNames.slice(0, 6),
            result_excerpt: excerpt,
          },
        }
      : {
          last_instruction: '',
          last_instruction_sha256: sha256Hex(rawInstruction),
          last_instruction_chars: rawInstruction.length,
          last_tool: {
            names: hashedLastTools,
            result_excerpt: '',
            result_excerpt_sha256: sha256Hex(rawExcerpt),
            result_excerpt_chars: rawExcerpt.length,
          },
        }),
    failure_evidence_heuristic: decision.state.failureEvidence.slice(0, 3),
    available_tools: allowSnippets ? decision.state.toolNames.slice(0, 40) : hashedAvailable,
    evidence,
  })
  let state = build()
  while (allowSnippets && JSON.stringify(state).length > maxChars && excerpt.length > 200) {
    excerpt = excerpt.slice(0, Math.floor(excerpt.length / 2))
    state = build()
  }
  if (JSON.stringify(state).length > maxChars) {
    evidence = buildJudgeEvidence(body, decision, Math.max(400, Math.floor(maxChars / 4)), egress)
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

  const hardGate = decision.state.failure === 'transport' || decision.state.failureEvidence.includes('permission-denial') || decision.state.verification?.reason === 'invalid-receipt' || decision.recovery?.action === 'ask-user'
  if (hardGate) {
    record.note = 'deterministic recovery gate bypassed judge action'
    return { decision, record }
  }
  if (outcome.recoveryAction !== undefined) {
    next = {
      ...next,
      recovery: recoveryPlanFromCandidate(outcome.recoveryAction, next.recovery ?? planRecovery({ state: decision.state })),
    }
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
