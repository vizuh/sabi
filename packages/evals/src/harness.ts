import { decideTier, extractTrajectoryState, estimateCost, type CostRates, type SabiConfig, type TrajectoryState } from '@sabi/core'
import type { EvalTask } from './tasks.ts'

export interface EvalConfigInput {
  policy?: Record<string, string>
  /** Model tier names, from the same config. */
  models: Record<string, { contextWindow?: number; cost?: CostRates }>
  /** Fixed baseline tier name to compare against, e.g. "mid". */
  baselineTier?: string
  /** Context window (tokens) to assume when running the context-pressure rule. */
  contextWindow?: number
}

export interface TaskRounds {
  taskId: string
  /** One row per round in the task transcript. */
  rounds: Array<{
    turn: number
    rule: string
    tier: string
    reason: string
    contextTokens?: number
    repeatedFailure?: boolean
    failureStreak?: number
  }>
  /** Baseline tier for the same turn (fixed model). */
  baselineTier: string
  /** Recorded task quality outcome. */
  outcome: EvalTask['outcome']
}

export interface EvalSummary {
  tasks: TaskRounds[]
  totals: {
    tasks: number
    passed: number
    failed: number
    blocked: number
    rounds: number
  }
  routing: {
    byRule: Record<string, number>
    byTier: Record<string, number>
  }
  baseline: {
    tier: string
    rounds: number
    cost: number
  }
  sabi: {
    cost: number
    savingsPct: number
  }
  quality: {
    /** Passed tasks that Sabi would route through at most the baseline tier. */
    passedWithinBaseline: number
    /** Failed/blocked tasks that Sabi routed to strong (escaped a cheap choice). */
    failedEscalated: number
  }
}

/**
 * Offline evaluation: replay a frozen task set through Sabi's deterministic routing and
 * compare against a fixed eligible baseline model. No paid calls, no judge, no network.
 * The metrics are exactly the scorecard's "next evidence": completed-task quality (pass/
 * fail/blocked), total usage/cost, and per-task routing — not token repricing alone.
 */
export function runEval(config: EvalConfigInput, tasks: EvalTask[]): EvalSummary {
  const policy = config.policy ?? {
    failure: 'strong',
    stuck: 'mid',
    'context-pressure': 'mid',
    transport: 'mid',
    'first-turn': 'mid',
    verification: 'mid',
    implementation: 'mid',
    exploration: 'cheap',
    unclassified: 'cheap',
  }
  const baselineTier = config.baselineTier ?? 'mid'
  const baselineRates = config.models[baselineTier]?.cost

  const results: TaskRounds[] = []
  const byRule: Record<string, number> = {}
  const byTier: Record<string, number> = {}
  let totalRounds = 0
  let passed = 0
  let failed = 0
  let blocked = 0
  let sabiCost = 0
  let baselineCost = 0
  let passedWithinBaseline = 0
  let failedEscalated = 0

  for (const task of tasks) {
    const messages = task.messages
    const rounds: TaskRounds['rounds'] = []
    let previousFailure: { failure: TrajectoryState['failure']; failureEvidence: string[] } | undefined

    // Replay the transcript at tool-result boundaries only. A round is: the assistant's
    // tool_calls message plus the tool result that follows; routing sees the state *after*
    // that result, which is what prepareNextTurn would observe. A bare user message (no
    // tool calls) is its own first-turn round.
    const boundaries: number[] = []
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]
      if (message?.role === 'tool') boundaries.push(i)
    }
    if (boundaries.length === 0) boundaries.push(0)

    for (const at of boundaries) {
      const slice = messages.slice(0, at + 1)
      const body = { model: 'sabi-code', messages: slice, tools: undefined }
      const state = extractTrajectoryState(body)
      // Carry the previous failure across turns for the stuck rule: compare the *stored*
      // previous round's failure with the current one, then update the stored value.
      const ranBefore = previousFailure !== undefined
      const wasHard = previousFailure?.failure === 'hard'
      if (state.failure === 'hard') {
        state.repeatedFailure = ranBefore && wasHard
        state.failureStreak = state.repeatedFailure ? 2 : 1
      } else {
        state.repeatedFailure = false
        state.failureStreak = 0
      }
      state.contextWindow = config.contextWindow
      // The proxy path leaves context estimation unknown; for the offline replay we know the
      // transcript exactly, so provide the estimate when a window is declared.
      if (config.contextWindow !== undefined && state.contextTokens === undefined) {
        state.contextTokens = state.estimatedTokens
        state.contextKnown = true
      }

      const decision = decideTier(state, policy)
      rounds.push({
        turn: at,
        rule: decision.rule,
        tier: decision.tier,
        reason: decision.reason,
        contextTokens: state.contextTokens,
        repeatedFailure: state.repeatedFailure,
        failureStreak: state.failureStreak,
      })
      byRule[decision.rule] = (byRule[decision.rule] ?? 0) + 1
      byTier[decision.tier] = (byTier[decision.tier] ?? 0) + 1
      totalRounds += 1
      const model = config.models[decision.tier]
      sabiCost += estimateCost({ promptTokens: 1000, completionTokens: 200, cachedTokens: 0, totalTokens: 1200 }, model?.cost).total
      previousFailure = { failure: state.failure, failureEvidence: state.failureEvidence }
    }

    results.push({
      taskId: task.id,
      rounds,
      baselineTier,
      outcome: task.outcome,
    })

    if (task.outcome === 'pass') {
      passed += 1
      // Passed a task while never routing above the baseline tier → evidence of useful routing.
      if (rounds.every((round) => round.tier === baselineTier)) passedWithinBaseline += 1
    } else if (task.outcome === 'fail') {
      failed += 1
      // Failed a task but routed to strong at least once → escalation happened (not necessarily correct).
      if (rounds.some((round) => round.tier === 'strong')) failedEscalated += 1
    } else {
      blocked += 1
    }

    // Baseline cost: count the same rounds but always on the baseline tier.
    const baselineModel = config.models[baselineTier]
    baselineCost += rounds.length * estimateCost({ promptTokens: 1000, completionTokens: 200, cachedTokens: 0, totalTokens: 1200 }, baselineModel?.cost).total
  }

  return {
    tasks: results,
    totals: { tasks: tasks.length, passed, failed, blocked, rounds: totalRounds },
    routing: { byRule, byTier },
    baseline: { tier: baselineTier, rounds: totalRounds, cost: baselineCost },
    sabi: { cost: sabiCost, savingsPct: baselineCost > 0 ? (1 - sabiCost / baselineCost) * 100 : 0 },
    quality: { passedWithinBaseline, failedEscalated },
  }
}

export function formatSummary(summary: EvalSummary): string {
  const lines = [
    `Sabi offline eval — ${summary.totals.tasks} tasks, ${summary.totals.rounds} rounds`,
    `pass ${summary.totals.passed} · fail ${summary.totals.failed} · blocked ${summary.totals.blocked}`,
    `routing  ${[...Object.entries(summary.routing.byTier)].map(([k, v]) => `${k}:${v}`).join(' ') || '—'}`,
    `rules    ${[...Object.entries(summary.routing.byRule)].map(([k, v]) => `${k}:${v}`).join(' ') || '—'}`,
    `baseline ${summary.baseline.tier} → $${summary.baseline.cost.toFixed(4)} · sabi → $${summary.sabi.cost.toFixed(4)} · savings ${summary.sabi.savingsPct.toFixed(1)}% (offline repricing)`,
    `quality  ${summary.quality.passedWithinBaseline}/${summary.totals.passed} passed tasks never above the baseline · ${summary.quality.failedEscalated}/${summary.totals.failed} failed tasks escalated to strong`,
  ]
  return lines.join('\n')
}