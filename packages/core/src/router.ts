import { ensureRouteCompatible, firstServingTier, SabiRouteError, servesInputModalities } from './compatibility.ts'
import { decideTier } from './policy.ts'
import { extractTrajectoryState } from './state.ts'
import type { ChatRequestBody, RouteDecision, SabiConfig } from './types.ts'

export { ensureRouteCompatible, SabiRouteError } from './compatibility.ts'

export function normalizeAlias(model: unknown): string {
  const raw = String(model ?? '').trim()
  return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
}

export function route(body: ChatRequestBody, config: SabiConfig): RouteDecision {
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
  const state = extractTrajectoryState(body)
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
  // Input modalities are a hard constraint, not a preference. A policy tier that cannot accept the
  // request (an image on a text-only model) is skipped for the first tier that can, so the round is
  // served instead of failing upstream with "no endpoints found that support image input".
  if (!servesInputModalities(planned.capabilities?.inputModalities, required)) {
    const alternate = firstServingTier(config.models, required, (entry) => entry.capabilities?.inputModalities)
    if (alternate) {
      rule = 'capability'
      reason = `input needs ${required.join('+')}; '${tier}' (${planned.model}) cannot accept it, '${alternate}' can`
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
