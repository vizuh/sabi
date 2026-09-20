import type { AgentState, ModApi, ModContext, ModelRequestEvent, TurnUsage } from '@commandcode/harness'
import {
  appendDecision,
  hashIdentity,
  loadConfig,
  measuredContextTokens,
  modalitiesOf,
  planRound,
  sanitizeReason,
  sessionIdFor,
  telemetryPolicy,
  transcriptStats,
  trajectoryFromRound,
  type CatalogTier,
  type DecisionRecord,
  type HarnessRound,
  type HarnessToolCall,
  type RoundPlan,
  type SabiConfig,
  type TranscriptStats,
  type TrajectoryState,
  type UsageTotals,
} from '@sabi/core'
import path from 'node:path'

const MOD_ID = 'sabi'
const DECISION_TYPE = 'sabi/decision'
const CLIENT_ID = 'command-code'

type ConfigWithHarness = SabiConfig & { harness?: { tiers?: Record<string, CatalogTier> } }

interface Ledger {
  rounds: number
  /** Transcript length seen at the end of the previous turn; a shrink is a host compaction. */
  messageCount: number
  contextChars: number
  /** Provider-billed total of the last round, when usage arrived. Measured, never estimated. */
  contextTokens?: number
  /** Host compactions observed for this session. */
  generation?: number
  toolNames: string[]
  hasTools: boolean
  lastModel?: string
  lastUsage?: TurnUsage
  /** Stable per-mod-session identity; created once and never derived from prompt content. */
  sessionId?: string
}

function readLedger(state: AgentState): Ledger {
  const raw = (state.modState?.[MOD_ID] ?? {}) as Partial<Ledger>
  return {
    rounds: typeof raw.rounds === 'number' ? raw.rounds : 0,
    messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
    contextChars: typeof raw.contextChars === 'number' ? raw.contextChars : 0,
    contextTokens: typeof raw.contextTokens === 'number' ? raw.contextTokens : undefined,
    generation: typeof raw.generation === 'number' ? raw.generation : undefined,
    toolNames: Array.isArray(raw.toolNames) ? raw.toolNames : [],
    hasTools: raw.hasTools === true,
    lastModel: raw.lastModel,
    lastUsage: raw.lastUsage,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : undefined,
  }
}

function writeLedger(state: AgentState, ledger: Ledger): AgentState {
  return { ...state, modState: { ...state.modState, [MOD_ID]: ledger } }
}

/** A transcript that came back shorter than the last turn's is a host rewrite, not drift. */
function compactedSince(ledger: Ledger, stats: TranscriptStats): boolean {
  return ledger.messageCount > 0 && stats.messageCount > 0 && stats.messageCount < ledger.messageCount
}

/** Match the proxy's stable tool identity without persisting raw tool names. */
function hashedToolNames(names: string[]): string[] {
  return names.map((name) => hashIdentity('tool', name))
}

/** Convert valid measured TurnUsage to UsageTotals; leave absent if no usage or invalid values. */
function toUsageTotals(usage: TurnUsage | undefined): UsageTotals | undefined {
  if (!usage) return undefined
  const validTokens = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!validTokens(usage.inputTokens) || !validTokens(usage.outputTokens)) return undefined
  const cachedTokens = usage.cachedInputTokens === undefined ? 0 : usage.cachedInputTokens
  if (!validTokens(cachedTokens) || cachedTokens > usage.inputTokens) return undefined
  const promptTokens = usage.inputTokens
  const completionTokens = usage.outputTokens
  const totalTokens = promptTokens + completionTokens
  if (!Number.isSafeInteger(totalTokens)) return undefined
  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    totalTokens,
  }
}

/** Derive the log path from the mod context's cwd, not process.cwd(). */
function logPathFor(ctx: ModContext | undefined): string | undefined {
  return ctx?.cwd?.trim() ? path.join(ctx.cwd, '.sabi', 'decisions.jsonl') : undefined
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
      // Create a stable session identity on the first turn; never derive from prompt content.
      if (!ledger.sessionId) {
        ledger.sessionId = sessionIdFor(undefined, CLIENT_ID)
      }
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
      // Counts what the transcript actually carries — every role, nested tool-result content and
      // media included; a screenshot a tool returned is media too. Positive evidence only.
      const stats = transcriptStats(state.messages)
      // The host owns compaction. When it rewrites the transcript, the attempt the model is
      // continuing is not the one the previous streak measured: restart the streak and advance
      // the generation, which also keeps a verdict formed before the rewrite out of cache.
      if (compactedSince(ledger, stats)) {
        previousFailure = undefined
        ledger.generation = (ledger.generation ?? 0) + 1
        ledger.contextTokens = undefined
      }
      const round: HarnessRound = {
        messageCount: stats.messageCount,
        assistantTurns: ledger.rounds,
        lastRole: calls.length > 0 ? 'tool' : 'assistant',
        contextChars: stats.contextChars,
        contextTokens: ledger.contextTokens,
        hasTools: ledger.hasTools,
        toolNames: ledger.toolNames,
        calls,
        ...(ledger.generation ? { contextGeneration: ledger.generation } : {}),
        ...(Object.keys(stats.media.counts).length
          ? { inputModalities: modalitiesOf(stats.media.counts), mediaCounts: stats.media.counts }
          : {}),
      }
      const trajectory = trajectoryFromRound(round, previousFailure)
      const plan = planRound(trajectory, policy, tiers, { contextWindow: config.harness?.contextWindow })
      if (!plan) return undefined
      nextPlan = plan
      return plan.effort ? { model: plan.model, effort: plan.effort } : { model: plan.model }
    },

    onTurnEnd: ({ state, turnNumber, usage }, ctx) => {
      const ledger = readLedger(state)
      const stats = transcriptStats(state.messages)
      // Persist the boundary here as well as in prepareNextTurn: that hook returns a plan, not
      // state, so this is where the generation and the streak restart become durable.
      const compacted = compactedSince(ledger, stats)
      const usedThisTurn = usage !== undefined
      const measured = usedThisTurn
        ? measuredContextTokens({ promptTokens: usage.inputTokens, completionTokens: usage.outputTokens })
        : undefined
      const generation = (ledger.generation ?? 0) + (compacted ? 1 : 0)
      // `servingPlan` is the plan consumed by the round that just ended; on the first round
      // there is no plan yet (the host serves it), so the adopted plan is the served one.
      const adopted = servingPlan ?? nextPlan
      const next: Ledger = {
        ...ledger,
        rounds: turnNumber,
        messageCount: stats.messageCount,
        contextChars: stats.contextChars,
        // A billed total is measured, so it floors the next round. Without usage the previous
        // floor stands — the transcript only grows — except across a rewrite, where the old
        // size described a context the host has removed.
        contextTokens: measured ?? (compacted ? undefined : ledger.contextTokens),
        ...(generation > 0 ? { generation } : {}),
        // Only advance attribution when a fresh value actually arrived this turn. A missing
        // usage or model event stays unknown rather than re-serializing an old round's value.
        lastModel: servedBy,
        lastUsage: usedThisTurn ? usage : undefined,
      }
      previousFailure = adopted ? { failure: adopted.state.failure, failureEvidence: adopted.state.failureEvidence } : undefined

      // Persist the existing custom entry for backwards compatibility.
      recordCustomEntry(ctx, {
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
              contextGeneration: servingPlan.state.contextGeneration,
              inputModalities: servingPlan.state.inputModalities,
            }
          : undefined,
        servedBy: servedBy ?? undefined,
        usage: usedThisTurn ? usage : undefined,
        // Decision records never embed raw tool output by default; snippet capture is opt-in.
        captureSnippets: telemetry.captureSnippets,
      })

      // Persist a normalized DecisionRecord only for rounds that actually had a Sabi serving plan.
      // The first host-served round (no servingPlan) is not a planned decision.
      if (servingPlan) {
        const sessionId = ledger.sessionId ?? sessionIdFor(undefined, CLIENT_ID)
        const usageTotals = toUsageTotals(usage)
        const decision: DecisionRecord = {
          ts: new Date().toISOString(),
          sessionId,
          // sessionKnown stays false: the host does not expose a real session ID to the mod.
          client: CLIENT_ID,
          turnId: hashIdentity('turn', sessionId, String(turnNumber)),
          servedModel: servedBy ?? undefined,
          alias: 'sabi-code',
          mode: 'auto',
          rule: servingPlan.rule,
          tier: servingPlan.tier,
          reason: sanitizeReason(String(servingPlan.reason ?? ''), telemetry),
          // This is the host adapter, not a provider entitlement claim.
          upstream: CLIENT_ID,
          upstreamModel: servingPlan.model,
          stream: false,
          state: {
            ...servingPlan.state,
            // Hash tool names; never persist raw tool outputs or args.
            toolNames: hashedToolNames(servingPlan.state.toolNames),
            lastToolNames: hashedToolNames(servingPlan.state.lastToolNames),
          },
          sessionKnown: false,
          ...(usageTotals ? { usage: usageTotals } : {}),
          // outcome means the model request round completed, not that the whole task succeeded.
          outcome: 'ok',
        }
        const logFile = logPathFor(ctx)
        if (logFile) {
          // Logging is evidence, not a reason to break the host harness on a full or read-only disk.
          try { appendDecision(decision, logFile) } catch { /* fail open */ }
        }
      }

      return writeLedger(state, next)
    },
  })
}

/** Persist the existing custom entry format for backwards compatibility. */
function recordCustomEntry(ctx: ModContext | undefined, data: Record<string, unknown>): void {
  // A bare unit-test harness has no session store; the decision is simply not persisted.
  ctx?.session?.appendCustomEntry({ customType: DECISION_TYPE, data })
}
