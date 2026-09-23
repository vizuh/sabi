import { cheapestServingTier, ensureRouteCompatible, isEnabledUpstream, modelRouteCost, SabiRouteError, servesInputModalities, servesUpstreamBilling } from './compatibility.ts'
import { cacheAwareRoute } from './cache-routing.ts'
import { tiersFor } from './config.ts'
import { decideTier } from './policy.ts'
import { planRecovery } from './recovery-actions.ts'
import { applyMeasuredContext, extractTrajectoryState } from './state.ts'
import type { ChatRequestBody, FailureLevel, ModelModality, RouteDecision, SabiConfig } from './types.ts'

export { ensureRouteCompatible, isEnabledUpstream, SabiRouteError } from './compatibility.ts'

/**
 * One transport-fallback candidate: the next serving tier after the planned tier
 * failed with a retryable upstream status. Cost-ordered (ties by tier name), matching
 * the router's availability/capability fallback — independent of declaration order.
 */
export interface FallbackTier {
  tier: string
  reason: string
  upstream: string
  upstreamModel: string
}

export function getFallbackChain(config: SabiConfig, failedTier: string, required: readonly ModelModality[] = []): FallbackTier[] {
  const failedModel = config.models[failedTier]
  if (!failedModel) return []
  return Object.keys(config.models)
    .filter((name) => {
      if (name === failedTier) return false
      const entry = config.models[name]
      return entry !== undefined &&
        isEnabledUpstream(config.upstreams[entry.upstream]) &&
        servesUpstreamBilling(config.upstreams[entry.upstream], entry) &&
        servesInputModalities(entry.capabilities?.inputModalities, required)
    })
    .sort((a, b) => {
      const costA = modelRouteCost(config.models[a])
      const costB = modelRouteCost(config.models[b])
      if (costA !== costB) return costA - costB
      return a < b ? -1 : a > b ? 1 : 0
    })
    .map((tier) => {
      const entry = config.models[tier]
      return {
        tier,
        reason: `fallback from ${failedTier} (${failedModel.model}) after transport failure`,
        upstream: entry.upstream,
        upstreamModel: entry.model,
      }
    })
}

export function normalizeAlias(model: unknown): string {
  const raw = String(model ?? '').trim()
  return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
}
function requestedOutputTokens(body: ChatRequestBody): number | undefined {
  const value = body.max_completion_tokens ?? body.max_tokens
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function outputFits(entry: { maxOutputTokens?: number }, requested: number | undefined): boolean {
  return requested === undefined || entry.maxOutputTokens === undefined || requested <= entry.maxOutputTokens
}


/**
 * What a caller can add that the request body cannot show: a measured context from the previous
 * round of this session, how many transcript rewrites the host has performed, the serving
 * window for context-pressure, and the previous round's failure for stuck detection. All
 * optional — an unknown stays unknown. Unattributed requests (no session) carry a window at
 * most: with no continuity there is no previous failure to compare against.
 */
export interface RouteContext {
  measuredContextTokens?: number
  contextGeneration?: number
  contextWindow?: number
  previousFailure?: FailureLevel
  previousFailureStreak?: number
  previousTier?: string
  previousRoundKind?: RouteDecision['state']['roundKind']
  previousLastRole?: string
  previousGeneration?: number
  previousCache?: import('./types.ts').CacheObservation
}

export function route(body: ChatRequestBody, config: SabiConfig, context: RouteContext = {}): RouteDecision {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SabiRouteError('request must be a JSON object')
  }
  const alias = normalizeAlias(body.model)
  const target = alias && Object.hasOwn(config.aliases, alias) ? config.aliases[alias] : undefined
  if (!target) {
    throw new SabiRouteError(
      `unknown model '${String(body.model ?? '')}' — Sabi serves: ${Object.keys(config.aliases).join(', ')}`,
      404,
    )
  }
  const state = applyMeasuredContext(extractTrajectoryState(body), context)
  // The proxy sees the whole wire body but no host catalog handle: the serving window is the
  // smallest declared window across the tiers the policy could pick — and only when every
  // reachable tier declares one. Without it `context-pressure` is unreachable: unknown stays unknown.
  if (state.contextWindow === undefined) {
    const explicit = context.contextWindow
    if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
      state.contextWindow = explicit
    } else {
      const candidates = tiersFor(config, 'auto')
      const windows = candidates.map((tier) => config.models[tier]?.contextWindow)
      if (windows.length && windows.every((value): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        state.contextWindow = Math.min(...windows)
      }
    }
  }
  // Stuck is consecutive hard failures for the same identified session. The proxy learns the
  // previous round only from its own session memory (server.ts); unattributed requests never
  // claim a streak. The streak is a repeated-failure depth flag (1 = first hard round,
  // 2 = repeated), matching the harness — not an unbounded count.
  if (state.repeatedFailure !== true && context.previousFailure === 'hard' && state.failure === 'hard') {
    state.repeatedFailure = true
    state.failureStreak = (context.previousFailureStreak ?? 1) >= 1 ? (context.previousFailureStreak ?? 1) + 1 : 2
    if (!Number.isSafeInteger(state.failureStreak) || (state.failureStreak ?? 0) < 2) state.failureStreak = 2
  } else if (state.failure === 'hard' && (state.failureStreak ?? 0) === 0) {
    state.failureStreak = 1
  }
  const recovery = planRecovery({ state })
  // Intervention is classified before the route tier; the tier remains subject to the native
  // policy and capability checks, while the bounded action is carried for the host/controller.
  const required = state.inputModalities ?? []
  const requestedOutput = requestedOutputTokens(body)
  const servesRound = (entry: (typeof config.models)[string]): boolean =>
    isEnabledUpstream(config.upstreams[entry.upstream]) &&
    servesUpstreamBilling(config.upstreams[entry.upstream], entry) &&
    servesInputModalities(entry.capabilities?.inputModalities, required) &&
    outputFits(entry, requestedOutput)
  // A substitute has to *declare* the capacity it is being chosen for. An undeclared ceiling still
  // serves the tier the policy itself picked (legacy metadata omissions), but it must never win a
  // promotion: unknown capacity would otherwise beat a tier that proves it can serve, and hand a
  // 64k-output round to whichever tier happens to sort first.
  const servesAsSubstitute = (entry: (typeof config.models)[string]): boolean =>
    servesRound(entry) && (requestedOutput === undefined || entry.maxOutputTokens !== undefined)
  const outputCapacityReason = (from: string, entry: (typeof config.models)[string], to: string): string =>
    `requested output ${requestedOutput?.toLocaleString()} exceeds '${from}' maxOutputTokens ${entry.maxOutputTokens?.toLocaleString()}; '${to}' can serve`

  if (target !== 'auto') {
    const model = Object.hasOwn(config.models, target) ? config.models[target] : undefined
    if (!model) throw new SabiRouteError(`alias '${alias}' targets unknown tier '${target}'`, 500)
    if (!outputFits(model, requestedOutput)) {
      const alternate = cheapestServingTier(config.models, (_name, entry) => servesAsSubstitute(entry))
      if (alternate && alternate !== target) {
        const promoted = config.models[alternate]!
        const decision: RouteDecision = {
          alias,
          mode: 'fixed',
          rule: 'output-capacity',
          tier: alternate,
          reason: outputCapacityReason(target, model, alternate),
          model: alternate,
          upstream: promoted.upstream,
          upstreamModel: promoted.model,
          state,
          recovery,
        }
        ensureRouteCompatible(body, config, decision)
        return decision
      }
    }
    const decision: RouteDecision = {
      alias,
      mode: 'fixed',
      rule: 'alias',
      tier: target,
      reason: `fixed alias -> ${target}`,
      model: target,
      upstream: model.upstream,
      upstreamModel: model.model,
      state,
      recovery,
    }
    ensureRouteCompatible(body, config, decision)
    return decision
  }
  let { rule, tier, reason } = decideTier(state, config.policy)
  const planned = Object.hasOwn(config.models, tier) ? config.models[tier] : undefined
  if (!planned) throw new SabiRouteError(`policy rule '${rule}' maps to unknown tier '${tier}'`, 500)
  // Input modality, output capacity and upstream availability are hard constraints, not preferences.
  // A policy tier that cannot accept the request is skipped for the cheapest tier that satisfies it.
  // This keeps adaptive and explicit aliases from failing only because a caller requested more output
  // than the planned tier can provide.
  if (!servesRound(planned)) {
    const disabled = !isEnabledUpstream(config.upstreams[planned.upstream])
    const priced = !servesUpstreamBilling(config.upstreams[planned.upstream], planned)
    const outputLimited = !outputFits(planned, requestedOutput)
    const alternate = cheapestServingTier(config.models, (_name, entry) => servesAsSubstitute(entry))
    if (alternate) {
      rule = outputLimited ? 'output-capacity' : disabled ? 'availability' : priced ? 'billing' : 'capability'
      reason = outputLimited
        ? outputCapacityReason(tier, planned, alternate)
        : disabled
          ? `upstream for '${tier}' (${planned.model}) is disabled; '${alternate}' can serve`
          : priced
            ? `upstream for '${tier}' (${planned.model}) is free-models-only; '${alternate}' can serve`
            : `input needs ${required.join('+')}; '${tier}' (${planned.model}) cannot accept it, '${alternate}' can`
      tier = alternate
    }
  }
  const previousModel = context.previousTier ? config.models[context.previousTier] : undefined
  const cache = cacheAwareRoute({
    state,
    recoveryAction: recovery?.action,
    plannedTier: tier,
    previousTier: context.previousTier,
    previousLastRole: context.previousLastRole,
    previousGeneration: context.previousGeneration,
    previousCache: context.previousCache,
    previousCost: previousModel?.cost,
    plannedCost: config.models[tier]?.cost,
    canKeepPrevious: Boolean(context.previousTier && config.models[context.previousTier] && servesRound(config.models[context.previousTier]!)),
  })
  if (cache.selectedTier !== tier) {
    tier = cache.selectedTier
    rule = 'cache-affinity'
    reason = cache.reason
  }
  const model = Object.hasOwn(config.models, tier) ? config.models[tier] : undefined
  if (!model) throw new SabiRouteError(`policy rule '${rule}' maps to unknown tier '${tier}'`, 500)
  const decision: RouteDecision = {
    alias,
    mode: 'auto',
    rule,
    tier,
    reason,
    model: tier,
    upstream: model.upstream,
    upstreamModel: model.model,
    state,
    recovery,
    cache,
  }
  ensureRouteCompatible(body, config, decision)
  return decision
}
