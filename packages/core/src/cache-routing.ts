import type {
  CacheObservation,
  CacheRoutingAction,
  CacheRoutingDecision,
  CacheRoutingPhase,
  CostRates,
  RecoveryAction,
  TrajectoryState,
  UsageTotals,
} from './types.ts'

export interface CacheRoutingInput {
  state: Pick<TrajectoryState, 'lastRole' | 'failure' | 'contextGeneration' | 'contextTokens' | 'estimatedTokens'>
  recoveryAction?: RecoveryAction
  plannedTier: string
  previousTier?: string
  previousLastRole?: string
  previousGeneration?: number
  previousCache?: CacheObservation
  previousCost?: CostRates
  plannedCost?: CostRates
  canKeepPrevious?: boolean
}

const SWITCH_ACTIONS = new Set<RecoveryAction>([
  'escalate-model',
  'fresh-context',
  'rollback-with-reflection',
  'retry-with-feedback',
])

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function boundedTokens(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && finiteNonNegative(value) ? value : undefined
}

export function cacheObservationFromUsage(usage: UsageTotals | undefined): CacheObservation {
  if (!usage || !Number.isSafeInteger(usage.promptTokens) || usage.promptTokens < 0 ||
      !Number.isSafeInteger(usage.cachedTokens) || usage.cachedTokens < 0) {
    return { status: 'unknown' }
  }
  const cachedTokens = Math.min(usage.promptTokens, usage.cachedTokens)
  return {
    status: cachedTokens > 0 ? 'hit' : 'miss',
    promptTokens: usage.promptTokens,
    cachedTokens,
  }
}

function phaseOf(input: CacheRoutingInput, sameToolCycle: boolean): CacheRoutingPhase {
  if (input.state.failure === 'hard') return 'failure'
  if (input.recoveryAction && SWITCH_ACTIONS.has(input.recoveryAction)) return 'escalation'
  if (sameToolCycle) return 'same-tool-cycle'
  if (input.previousTier !== undefined) return 'new-phase'
  return 'unknown'
}

function routeCost(rate: number | undefined, tokens: number | undefined): number | undefined {
  return finiteNonNegative(rate) && boundedTokens(tokens) !== undefined ? rate * tokens! / 1e6 : undefined
}

function switchEconomics(input: CacheRoutingInput, cachedTokens: number | undefined, contextTokens: number | undefined): Pick<CacheRoutingDecision, 'expectedGain' | 'cachePenalty'> {
  const expectedGain = input.previousCost && input.plannedCost && contextTokens !== undefined
    ? routeCost(Math.max(0, input.previousCost.input - input.plannedCost.input), contextTokens)
    : undefined
  const cachePenalty = input.previousCost && input.plannedCost && cachedTokens !== undefined
    ? routeCost(Math.max(0, input.plannedCost.input - (input.previousCost.cacheRead ?? input.previousCost.input)), cachedTokens)
    : undefined
  return {
    ...(expectedGain !== undefined ? { expectedGain } : {}),
    ...(cachePenalty !== undefined ? { cachePenalty } : {}),
  }
}

function result(
  input: CacheRoutingInput,
  action: CacheRoutingAction,
  phase: CacheRoutingPhase,
  selectedTier: string,
  reason: string,
  extra: Partial<CacheRoutingDecision> = {},
): CacheRoutingDecision {
  const cache = input.previousCache
  const contextTokens = boundedTokens(input.state.contextTokens) ?? boundedTokens(input.state.estimatedTokens)
  const cachedTokens = boundedTokens(cache?.cachedTokens)
  const reprocessTokens = cache?.status === 'hit' && cachedTokens !== undefined ? cachedTokens : undefined
  return {
    action,
    phase,
    cacheStatus: cache?.status ?? 'unknown',
    plannedTier: input.plannedTier,
    selectedTier,
    ...(input.previousTier !== undefined ? { previousTier: input.previousTier } : {}),
    ...(contextTokens !== undefined ? { estimatedContextTokens: contextTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(reprocessTokens !== undefined ? { reprocessTokens } : {}),
    ...extra,
    reason,
  }
}

/**
 * Keep a known route-affine prefix unless a measured cost benefit beats its loss. The quality
 * benefit of a stronger model is intentionally not guessed; failure/escalation is the explicit
 * override. ponytail: cost-only heuristic; add measured per-task quality utility before making
 * unforced quality upgrades through a warm cache.
 */
export function cacheAwareRoute(input: CacheRoutingInput): CacheRoutingDecision {
  const sameToolCycle = input.state.lastRole === 'tool' &&
    input.previousTier !== undefined && (input.state.contextGeneration ?? 0) === (input.previousGeneration ?? 0)
  const phase = phaseOf(input, sameToolCycle)
  const canKeep = input.previousTier !== undefined && input.canKeepPrevious !== false
  const cache = input.previousCache
  const cachedTokens = boundedTokens(cache?.cachedTokens)
  const contextTokens = boundedTokens(input.state.contextTokens) ?? boundedTokens(input.state.estimatedTokens)
  const economics = switchEconomics(input, cachedTokens, contextTokens)

  if (!input.previousTier || !canKeep) {
    return result(input, 'evaluate', phase, input.plannedTier, 'no usable previous route affinity; policy decision evaluated', economics)
  }
  if (input.plannedTier === input.previousTier) {
    return result(input, 'evaluate', phase, input.previousTier, 'policy selected the current model; route unchanged', economics)
  }
  if (phase === 'same-tool-cycle') {
    return result(input, 'keep', phase, input.previousTier, 'same tool cycle; keep the current model', economics)
  }
  if (phase === 'failure' || phase === 'escalation') {
    return result(input, 'switch', phase, input.plannedTier, 'failure or escalation requires evaluating a different model', economics)
  }
  if (cache?.status === 'hit' && cachedTokens !== undefined &&
      economics.expectedGain !== undefined && economics.cachePenalty !== undefined &&
      economics.expectedGain > economics.cachePenalty) {
    return result(input, 'switch', phase, input.plannedTier, 'expected cost gain exceeds the measured cache penalty', economics)
  }
  if (cache?.status === 'hit' && cachedTokens !== undefined) {
    return result(input, 'keep', phase, input.previousTier, 'cache hit retained; unpriced policy gain does not exceed cache loss', economics)
  }
  return result(input, 'switch', phase, input.plannedTier, 'policy changed phase without a measured cache hit to preserve', economics)
}
