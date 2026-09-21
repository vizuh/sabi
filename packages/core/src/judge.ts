import { createHash } from 'node:crypto'
import { cheapestServingTier, isEnabledUpstream, servesInputModalities } from './compatibility.ts'
import { decideTier } from './policy.ts'
import { hashIdentity } from './log.ts'
import { candidateBeatsIncumbent, recoveryRate, type RecoveryProfile } from './recovery.ts'
import { textOf } from './state.ts'
import type { ChatRequestBody, JudgeConfig, JudgeRecord, JevRoutingConfig, RouteDecision, SabiConfig } from './types.ts'

/** Minimal PII redaction for text sent to the Jev routing/judge endpoint.
 * Masks emails, phones, API-key-like tokens, and long hex strings.
 * Conservative first pass — catches the most common leakage shapes without
 * parsing every possible credential format. */
const PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[email]' },
  { re: /\b(?:\+?[\d]{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g, replacement: '[phone]' },
  { re: /\b(?:sk-|pk-|ai-|hk-)[a-zA-Z0-9]{20,}\b/g, replacement: '[key]' },
  { re: /\b[0-9a-f]{32,}\b/gi, replacement: '[hash]' },
  { re: /\bghp_[0-9a-zA-Z]{36}\b/gi, replacement: '[ghp-token]' },
  { re: /\bglpat-[0-9a-zA-Z\-]{20,}\b/gi, replacement: '[glpat-token]' },
]

/** Risk-word patterns for private-profile coarse-feature detection.
 * These are the raw regexes behind PII_PATTERNS — used for presence
 * detection only, never for redaction. */
const RISK_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { label: 'phone', re: /\b(?:\+?[\d]{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/ },
  { label: 'api-key', re: /\b(?:sk-|pk-|ai-|hk-)[a-zA-Z0-9]{20,}\b/ },
  { label: 'hex-hash', re: /\b[0-9a-f]{32,}\b/ },
  { label: 'ghp-token', re: /\bghp_[0-9a-zA-Z]{36}\b/ },
  { label: 'glpat-token', re: /\bglpat-[0-9a-zA-Z\-]{20,}\b/ },
]

function redactPii(text: string): string {
  let result = text
  for (const { re, replacement } of PII_PATTERNS) {
    result = result.replace(re, replacement)
  }
  return result
}

/** Coarse features extracted from a turn for private-profile routing.
 * These replace full turn text when the session matches a private profile —
 * enough signal for routing without exposing raw user/tool content. */
export interface CoarseTurnFeatures {
  /** Number of messages in the turn. */
  messageCount: number
  /** Total character count across all message contents. */
  totalChars: number
  /** Whether the turn appears to contain code (heuristic). */
  hasCode: boolean
  /** Risk-word labels detected in the combined turn text. */
  riskWords: string[]
}

/** Code-presence heuristic: checks for fenced code blocks, indented code lines,
 * and common code markers. Conservative — flags obvious code, not prose with
 * a few inline backticks. */
function detectCodePresence(messages: ChatRequestBody['messages']): boolean {
  const list = Array.isArray(messages) ? messages : []
  const combined = list.map((m) => textOf(m.content)).join('\n')
  // Fenced code blocks
  if (/```[\s\S]{10,}/.test(combined)) return true
  // Indented code lines (4+ spaces at line start, multiple lines)
  const indentedLines = combined.split('\n').filter((line) => /^ {4,}/.test(line))
  if (indentedLines.length >= 3) return true
  // Common code markers: function defs, imports, const/let/var declarations
  if (/\b(function|const|let|var|import|export|class|def |fn |async\s)/.test(combined)) return true
  return false
}

/** Extracts risk-word labels present in the combined turn text. */
function detectRiskWords(messages: ChatRequestBody['messages']): string[] {
  const list = Array.isArray(messages) ? messages : []
  const combined = list.map((m) => textOf(m.content)).join('\n')
  const found: string[] = []
  for (const { label, re } of RISK_PATTERNS) {
    if (re.test(combined)) found.push(label)
  }
  return found
}

/** Extracts coarse features from a turn for private-profile routing.
 * Replaces full turn text with structural features that preserve routing
 * signal without exposing raw user/tool content. */
export function extractCoarseFeatures(messages: ChatRequestBody['messages']): CoarseTurnFeatures {
  const list = Array.isArray(messages) ? messages : []
  let totalChars = 0
  for (const message of list) {
    totalChars += textOf(message.content).length
  }
  return {
    messageCount: list.length,
    totalChars,
    hasCode: detectCodePresence(list),
    riskWords: detectRiskWords(list),
  }
}

/** Which egress switch governs raw judge content. The judge endpoint is an explicit
 * off-machine surface: raw instruction/tool text leaves only when the operator opts
 * in via `judge.includeSnippets` (preferred) or the shared `telemetry.captureSnippets`.
 * The default is content-free — hashed tool identity, evidence codes and shape only.
 * When raw text does leave, PII is redacted before transmission. */
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

function trimmed(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text
}

/** Checks whether a session identity matches any entry in the private profiles list.
 * Matches are either exact or prefix-based (the profile entry is a prefix of the session). */
function sessionMatchesPrivateProfile(sessionId: string | undefined, profiles: string[] | undefined): boolean {
  if (!sessionId || !profiles || !profiles.length) return false
  for (const profile of profiles) {
    if (!profile) continue
    if (sessionId === profile || sessionId.startsWith(profile)) return true
  }
  return false
}

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
  /** Routing question: which tier should serve this turn. */
  routing: {
    type: 'choice'
    instructions: string
    criteria: Record<string, string>
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
  /** Routing question: which tier is appropriate for the coding agent's next turn. */
  routing: {
    type: 'choice',
    instructions:
      "Which tier is appropriate for the coding agent's next turn? Consider the last user instruction, the tool activity, the trajectory position, and the context size. A provider or subscription limit in the evidence (rate limit, session/usage/quota limit, too many requests) is not a reason to change tiers — it says the provider or the plan was exhausted. The policy's proposed tier is in `policy_tier` for reference; disagree only when the evidence clearly supports a different choice.",
    criteria: {
      cheap: 'Mechanical or bookkeeping work — reading, listing, searching, routine follow-ups, or the policy already proposed cheap and the evidence supports it',
      mid: 'Ordinary implementation, debugging, or verification work, or the policy already proposed mid and the evidence supports it',
      strong: 'Hard reasoning — architecture, subtle debugging, security review, multi-step planning, stuck after repeated failures, or the policy already proposed strong and the evidence supports it',
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
  /** Jev routing decision: which tier Jev recommends for this turn. */
  routingTier?: string
  /** Confidence for the routing decision. */
  routingConfidence?: number
  model?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export function judgeTriggers(decision: RouteDecision, config: JudgeConfig): boolean {
  if (!config.enabled) return false
  const callOn = config.callOn ?? ['failure', 'unclassified']
  return callOn.includes(decision.rule)
}

/** Returns true when Jev routing should be consulted for this decision.
 * Called for auto-mode rounds when the Jev routing config is enabled and
 * the callOn list includes 'auto'. */
export function jevRoutingTriggers(decision: RouteDecision, config: JevRoutingConfig): boolean {
  if (!config.enabled) return false
  const callOn = config.callOn ?? ['auto']
  return callOn.includes('auto') && decision.mode === 'auto'
}

/** Extracts the "opening" of the turn: the first message with role user, system,
 * or developer, in priority order (user > system > developer). Only returns non-empty content. */
function openingOf(messages: ChatRequestBody['messages']): string | undefined {
  const priority = ['user', 'system', 'developer'] as const
  for (const role of priority) {
    const msg = messages?.find((m) => m?.role === role)
    if (msg) {
      const text = textOf(msg.content)
      if (text) return text
    }
  }
  return undefined
}

/** Extracts the "end" of the turn: the last message with role assistant or tool,
 * in priority order (assistant > tool). Only returns non-empty content. */
function endOf(messages: ChatRequestBody['messages']): string | undefined {
  const priority = ['assistant', 'tool'] as const
  for (const role of priority) {
    const msg = messages?.slice().reverse().find((m) => m?.role === role)
    if (msg) {
      const text = textOf(msg.content)
      if (text) return text
    }
  }
  return undefined
}

/** Builds the state object sent to Jev for a routing decision.

 * The turn redaction shape is "opening + end of turn" rather than "last instruction
 * + last tool excerpt". The opening is the first user/system/developer message (priority
 * order); the end is the last assistant/tool message (priority order). They are combined
 * with a separator and the result is redacted for PII and capped at maxChars.
 *
 * When the session identity matches a private profile in `jev.privateProfiles`, the state
 * uses coarse features instead of full turn text — preserving routing signal without
 * exposing raw user/tool content. */
export function buildRoutingState(
  body: ChatRequestBody,
  decision: RouteDecision,
  policyTier: string,
  config: SabiConfig,
  maxChars = 2500,
  sessionId?: string,
): Record<string, unknown> {
  const egress: JudgeEgress = {
    captureSnippets: config.telemetry?.captureSnippets,
    includeSnippets: config.jev?.includeSnippets,
  }
  const allowSnippets = judgeAllowsSnippets(egress)
  const messages = Array.isArray(body.messages) ? body.messages : []

  // Check if this session matches a private profile — if so, use coarse features.
  const privateProfiles = config.jev?.privateProfiles
  const isPrivateProfile = sessionMatchesPrivateProfile(sessionId, privateProfiles)

  if (isPrivateProfile) {
    // Build state from coarse features only — no raw text.
    const coarse = extractCoarseFeatures(messages)
    const hashedLastTools = decision.state.lastToolNames.slice(0, 6).map((name) => hashIdentity('tool', name))
    const hashedAvailable = decision.state.toolNames.slice(0, 40).map((name) => hashIdentity('tool', name))
    return {
      round: {
        index: decision.state.assistantTurns,
        kind_heuristic: decision.state.roundKind,
        messages: decision.state.messageCount,
        context_tokens_estimate: decision.state.estimatedTokens,
        context_generation: decision.state.contextGeneration ?? 0,
      },
      last_instruction: '',
      last_instruction_sha256: sha256Hex(JSON.stringify(coarse)),
      last_instruction_chars: JSON.stringify(coarse).length,
      last_tool: {
        names: hashedLastTools,
        result_excerpt: '',
        result_excerpt_sha256: sha256Hex(JSON.stringify(coarse)),
        result_excerpt_chars: JSON.stringify(coarse).length,
      },
      failure_evidence_heuristic: decision.state.failureEvidence.slice(0, 3),
      available_tools: hashedAvailable,
      policy_tier: policyTier,
      private_profile: true,
      coarse_features: coarse,
    }
  }

  // Build the combined opening + end text (normal path).
  const opening = openingOf(messages)
  const end = endOf(messages)
  const separator = '\n--- MIDDLE OMITTED ---\n'
  let combined = ''
  if (opening) combined += opening
  if (opening && end) combined += separator
  if (end) combined += end

  const hashedLastTools = decision.state.lastToolNames.slice(0, 6).map((name) => hashIdentity('tool', name))
  const hashedAvailable = decision.state.toolNames.slice(0, 40).map((name) => hashIdentity('tool', name))

  // Build state from a given combined text. Used for iterative capping.
  const build = (text: string): Record<string, unknown> => {
    const raw = text
    const display = allowSnippets ? redactPii(raw) : raw
    return {
      round: {
        index: decision.state.assistantTurns,
        kind_heuristic: decision.state.roundKind,
        messages: decision.state.messageCount,
        context_tokens_estimate: decision.state.estimatedTokens,
        context_generation: decision.state.contextGeneration ?? 0,
      },
      ...(allowSnippets
        ? {
            // The combined opening+end text is the primary content for routing.
            last_instruction: display,
            last_tool: {
              names: decision.state.lastToolNames.slice(0, 6),
              // No separate tool excerpt — the combined text captures the full turn.
              result_excerpt: '',
            },
          }
        : {
            last_instruction: '',
            last_instruction_sha256: sha256Hex(raw),
            last_instruction_chars: raw.length,
            last_tool: {
              names: hashedLastTools,
              result_excerpt: '',
              result_excerpt_sha256: sha256Hex(raw),
              result_excerpt_chars: raw.length,
            },
          }),
      failure_evidence_heuristic: decision.state.failureEvidence.slice(0, 3),
      available_tools: allowSnippets ? decision.state.toolNames.slice(0, 40) : hashedAvailable,
    }
  }

  // Iterative capping: if the serialized state exceeds maxChars, truncate the
  // combined text (from the end, preserving the opening) until it fits.
  let current = combined
  let state = build(current)
  let safety = 0
  while (allowSnippets && JSON.stringify(state).length > maxChars && current.length > 200 && safety < 20) {
    current = current.slice(0, Math.floor(current.length / 2))
    state = build(current)
    safety++
  }

  return {
    ...state,
    policy_tier: policyTier,
  }
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
          last_instruction: redactPii(rawInstruction),
          last_tool: {
            names: decision.state.lastToolNames.slice(0, 6),
            result_excerpt: redactPii(excerpt),
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
  })
  let state = build()
  while (allowSnippets && JSON.stringify(state).length > maxChars && excerpt.length > 200) {
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
