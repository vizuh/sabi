import type { AgentState, ModApi, ModContext, ModelRequestEvent, TurnUsage } from '@commandcode/harness'
import {
  loadConfig,
  planRound,
  trajectoryFromRound,
  type CatalogTier,
  type HarnessRound,
  type HarnessToolCall,
  type RoundPlan,
  type SabiConfig,
} from '@sabi/core'

const MOD_ID = 'sabi'
const DECISION_TYPE = 'sabi/decision'

type ConfigWithHarness = SabiConfig & { harness?: { tiers?: Record<string, CatalogTier> } }

interface Ledger {
  rounds: number
  messageCount: number
  contextChars: number
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

  let calls: HarnessToolCall[] = []
  let nextPlan: RoundPlan | undefined
  let servingPlan: RoundPlan | undefined
  let servedBy: string | undefined

  cmd.on<ModelRequestEvent>('model_request_end', (event) => {
    if (typeof event.model === 'string') servedBy = event.model
  })

  cmd.hooks({
    onTurnStart: ({ state, turnNumber }) => {
      calls = []
      servingPlan = nextPlan
      nextPlan = undefined
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
        hasTools: ledger.hasTools,
        toolNames: ledger.toolNames,
        calls,
      }
      const plan = planRound(trajectoryFromRound(round), policy, tiers)
      if (!plan) return undefined
      nextPlan = plan
      return plan.effort ? { model: plan.model, effort: plan.effort } : { model: plan.model }
    },

    onTurnEnd: ({ state, turnNumber, usage }, ctx) => {
      const ledger = readLedger(state)
      const outputChars = calls.reduce((total, call) => total + (call.output?.length ?? 0), 0)
      const next: Ledger = {
        ...ledger,
        rounds: turnNumber,
        messageCount: ledger.messageCount + calls.length,
        contextChars: ledger.contextChars + outputChars,
        lastModel: servedBy ?? ledger.lastModel,
        lastUsage: usage ?? ledger.lastUsage,
      }
      recordDecision(ctx, {
        turn: turnNumber,
        planned: servingPlan
          ? {
              tier: servingPlan.tier,
              model: servingPlan.model,
              effort: servingPlan.effort,
              rule: servingPlan.rule,
              reason: servingPlan.reason,
              roundKind: servingPlan.state.roundKind,
              failure: servingPlan.state.failure,
              evidence: servingPlan.state.failureEvidence.slice(0, 3),
            }
          : undefined,
        servedBy: next.lastModel,
        usage: next.lastUsage,
      })
      return writeLedger(state, next)
    },
  })
}

function recordDecision(ctx: ModContext | undefined, data: Record<string, unknown>): void {
  // A bare unit-test harness has no session store; the decision is simply not persisted.
  ctx?.session?.appendCustomEntry({ customType: DECISION_TYPE, data })
}
