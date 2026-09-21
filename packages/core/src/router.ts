import { cheapestServingTier, ensureRouteCompatible, isEnabledUpstream, modelRouteCost, SabiRouteError, servesInputModalities } from './compatibility.ts'
import { tiersFor } from './config.ts'
import { decideTier } from './policy.ts'
import { applyMeasuredContext, extractTrajectoryState } from './state.ts'
import type { ChatRequestBody, FailureLevel, ModelModality, RouteDecision, SabiConfig } from './types.ts'

export { ensureRouteCompatible, isEnabledUpstream, servesInputModalities, SabiRouteError } from './compatibility.ts'

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

export interface FallbackTier {
  tier: string
  reason: string
  upstream: string
  upstreamModel: string
}

export function normalizeAlias(model: unknown): string {
  const raw = String(model ?? '').trim()
  return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
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
  if (target !== 'auto') {
    const model = Object.hasOwn(config.models, target) ? config.models[target] : undefined
    if (!model) throw new SabiRouteError(`alias '${alias}' targets unknown tier '${target}'`, 500)
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
    }
    ensureRouteCompatible(body, config, decision)
    return decision
  }
  const required = state.inputModalities ?? []
  let { rule, tier, reason } = decideTier(state, config.policy)
  const planned = Object.hasOwn(config.models, tier) ? config.models[tier] : undefined
  if (!planned) throw new SabiRouteError(`policy rule '${rule}' maps to unknown tier '${tier}'`, 500)
  // Input modality and upstream availability are both hard constraints, not preferences. A policy
  // tier that cannot accept the request, or whose upstream is disabled, is skipped for the cheapest
  // priced tier that satisfies both (ties by tier name) — otherwise disabling one upstream would 400
  // every round a policy rule happens to map to it, even when another enabled tier could serve it.
  // Cost order keeps the fallback deterministic and independent of JSON declaration order.
  const servesRound = (entry: typeof planned): boolean =>
    isEnabledUpstream(config.upstreams[entry.upstream]) && servesInputModalities(entry.capabilities?.inputModalities, required)
  if (!servesRound(planned)) {
    const disabled = !isEnabledUpstream(config.upstreams[planned.upstream])
    const alternate = cheapestServingTier(config.models, (_name, entry) => servesRound(entry))
    if (alternate) {
      rule = disabled ? 'availability' : 'capability'
      reason = disabled
        ? `upstream for '${tier}' (${planned.model}) is disabled; '${alternate}' can serve`
        : `input needs ${required.join('+')}; '${tier}' (${planned.model}) cannot accept it, '${alternate}' can`
      tier = alternate
    }
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
  }
  ensureRouteCompatible(body, config, decision)
  return decision
}

