import { decideTier } from './policy.ts'
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
}

export const JUDGE_QUESTIONS: JudgeQuestions = {
  real_problem: {
    type: 'noul',
    instructions:
      'The coding agent just received the tool result in `last_tool.result_excerpt`. Does it describe a genuine problem the agent must address now (failing tests, real errors, broken build, unexpected failure), rather than an expected or benign outcome?',
    criteria: {
      true: 'A real defect or failure that blocks or degrades the task and should be fixed or investigated',
      false:
        'An expected outcome (for example the user explicitly asked to run something that fails), informational output, a permission prompt or denial from the harness, or a failure unrelated to the task',
    },
  },
  difficulty: {
    type: 'choice',
    instructions:
      "How demanding is the agent's next step, given the state so far? Consider the last instruction, the tool activity, and the trajectory position.",
    criteria: {
      trivial: 'Mechanical or bookkeeping work — reading, listing, searching, routine follow-ups',
      standard: 'Ordinary implementation, debugging, or verification work',
      demanding:
        'Hard reasoning — architecture, subtle debugging, security review, multi-step planning, or the agent is stuck after repeated failures',
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
): { decision: RouteDecision; record: JudgeRecord } {
  const thresholds = config.judge?.thresholds ?? {}
  const realProblemFloor = thresholds.realProblem ?? 0.6
  const vetoFloor = thresholds.veto ?? 0.25
  const difficultyFloor = thresholds.difficultyConfidence ?? 0.6

  let next = decision
  const record: JudgeRecord = {
    status: 'ok',
    model: outcome.model,
    realProblem: outcome.realProblem,
    difficulty: outcome.difficulty,
    difficultyConfidence: outcome.difficultyConfidence,
    originalTier: decision.tier,
    finalTier: decision.tier,
    overridden: false,
    usage: outcome.usage,
  }

  const retier = (tier: string, rule: string, reason: string): boolean => {
    const model = config.models[tier]
    if (!model) return false
    const changed = tier !== next.tier
    next = { ...next, tier, rule, reason, model: tier, upstream: model.upstream, upstreamModel: model.model }
    record.finalTier = tier
    if (changed) {
      record.overridden = true
      record.direction = (TIER_ORDER[tier] ?? 0) < (TIER_ORDER[decision.tier] ?? 0) ? 'down' : 'up'
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
      record.note = 'ambiguous; deterministic escalation kept'
    }
  }

  if (next.rule === 'unclassified' && typeof outcome.difficulty === 'string') {
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
