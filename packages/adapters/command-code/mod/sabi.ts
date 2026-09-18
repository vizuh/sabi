import type { AgentState, ModApi, ModContext, ModelRequestEvent, TurnUsage } from '@commandcode/harness'
import {
  loadConfig,
  planRound,
  sanitizeReason,
  telemetryPolicy,
  trajectoryFromRound,
  type CatalogTier,
  type HarnessRound,
  type HarnessToolCall,
  type RoundPlan,
  type SabiConfig,
  type TrajectoryState,
} from '@sabi/core'

const MOD_ID = 'sabi'
const DECISION_TYPE = 'sabi/decision'

type ConfigWithHarness = SabiConfig & { harness?: { tiers?: Record<string, CatalogTier> } }

interface Ledger {
  rounds: number
  messageCount: number
  contextChars: number
  contextTokens?: number
  toolNames: string[]
  hasTools: boolean
  lastModel?: string
  lastUsage?: TurnUsage
}

function readLedger(state: AgentState): Ledger {
  const raw = (state.modState?.[MOD_ID] ?? {}) as Partial<Ledger>
  return {
    rounds: typeof raw.rounds === 'number' ? raw.rounds : 0,
    messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
    contextChars: typeof raw.contextChars === 'number' ? raw.contextChars : 0,
    contextTokens: typeof raw.contextTokens === 'number' ? raw.contextTokens : undefined,
    toolNames: Array.isArray(raw.toolNames) ? raw.toolNames : [],
    hasTools: raw.hasTools === true,
    lastModel: raw.lastModel,
    lastUsage: raw.lastUsage,
  }
}

function writeLedger(state: AgentState, ledger: Ledger): AgentState {
  return { ...state, modState: { ...state.modState, [MOD_ID]: ledger } }
}

export default function sabi(cmd: ModApi): void {
  let config: ConfigWithHarness
  try {
    config = loadConfig() as ConfigWithHarness
  } catch (error) {
    cmd.ui.notify(`Sabi disabled: ${(error as Error).message}`)
    return
  }

  const tiers = config.harness?.tiers ?? {}
  if (Object.keys(tiers).length === 0) {
    cmd.ui.notify('Sabi disabled: sabi.config.json declares no harness.tiers')
    return
  }
  const policy = config.policy ?? {}
  const telemetry = telemetryPolicy(config.telemetry)

  let calls: HarnessToolCall[] = []
  let nextPlan: RoundPlan | undefined
  let servingPlan: RoundPlan | undefined
  let servedBy: string | undefined
  let previousFailure: { failure: TrajectoryState['failure']; failureEvidence: string[] } | undefined
  let previousContextTokens: number | undefined

  cmd.on<ModelRequestEvent>('model_request_end', (event) => {
    if (typeof event.model === 'string') servedBy = event.model
  })

  cmd.hooks({
    onTurnStart: ({ state, turnNumber }) => {
      calls = []
      servingPlan = nextPlan
      nextPlan = undefined
      servedBy = undefined
      const ledger = readLedger(state)
      return writeLedger(state, { ...ledger, rounds: turnNumber })
    },

    // Sabi observes tool outcomes and never rewrites what the model sees.
    afterToolCall: ({ toolName, input, isError, result }) => {
      calls.push({
        name: toolName,
        args: JSON.stringify(input ?? {}),
        failed: isError === true,
        output: typeof result === 'string' ? result : undefined,
      })
      return undefined
    },

    prepareNextTurn: ({ state }) => {
      const ledger = readLedger(state)
      const round: HarnessRound = {
        messageCount: ledger.messageCount + calls.length,
        assistantTurns: ledger.rounds,
        lastRole: calls.length > 0 ? 'tool' : 'assistant',
        contextChars: ledger.contextChars,
        contextTokens: ledger.contextTokens,
        hasTools: ledger.hasTools,
        toolNames: ledger.toolNames,
        calls,
      }
      const trajectory = trajectoryFromRound(round, previousFailure)
      const plan = planRound(trajectory, policy, tiers, { contextWindow: config.harness?.contextWindow })
      if (!plan) return undefined
      // Track the planned state for the repeated-failure and context-pressure heuristics.
      previousContextTokens = plan.state.contextTokens
      nextPlan = plan
      return plan.effort ? { model: plan.model, effort: plan.effort } : { model: plan.model }
    },

    onTurnEnd: ({ state, turnNumber, usage }, ctx) => {
      const ledger = readLedger(state)
      const outputChars = calls.reduce((total, call) => total + (call.output?.length ?? 0), 0)
      const usedThisTurn = usage !== undefined
      // `servingPlan` is the plan consumed by the round that just ended; on the first round
      // there is no plan yet (the host serves it), so the adopted plan is the served one.
      const adopted = servingPlan ?? nextPlan
      const next: Ledger = {
        ...ledger,
        rounds: turnNumber,
        messageCount: ledger.messageCount + calls.length,
        contextChars: ledger.contextChars + outputChars,
        contextTokens: previousContextTokens,
        // Only advance attribution when a fresh value actually arrived this turn. A missing
        // usage or model event stays unknown rather than re-serializing an old round's value.
        lastModel: servedBy,
        lastUsage: usedThisTurn ? usage : undefined,
      }
      previousFailure = adopted ? { failure: adopted.state.failure, failureEvidence: adopted.state.failureEvidence } : undefined
      recordDecision(ctx, {
        turn: turnNumber,
        planned: servingPlan
          ? {
              tier: servingPlan.tier,
              model: servingPlan.model,
              effort: servingPlan.effort,
              rule: servingPlan.rule,
              reason: sanitizeReason(String(servingPlan.reason ?? ''), telemetry),
              roundKind: servingPlan.state.roundKind,
              failure: servingPlan.state.failure,
              evidence: servingPlan.state.failureEvidence.slice(0, 3),
              repeatedFailure: servingPlan.state.repeatedFailure,
              failureStreak: servingPlan.state.failureStreak,
              contextTokens: servingPlan.state.contextTokens,
            }
          : undefined,
        servedBy: servedBy ?? undefined,
        usage: usedThisTurn ? usage : undefined,
        // Decision records never embed raw tool output by default; snippet capture is opt-in.
        captureSnippets: telemetry.captureSnippets,
      })
      return writeLedger(state, next)
    },
  })
}

function recordDecision(ctx: ModContext | undefined, data: Record<string, unknown>): void {
  // A bare unit-test harness has no session store; the decision is simply not persisted.
  ctx?.session?.appendCustomEntry({ customType: DECISION_TYPE, data })
}
