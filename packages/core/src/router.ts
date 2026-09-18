import { decideTier } from './policy.ts'
import { extractTrajectoryState } from './state.ts'
import type { ChatRequestBody, RouteDecision, SabiConfig } from './types.ts'

export class SabiRouteError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SabiRouteError'
    this.status = status
  }
}

export function normalizeAlias(model: unknown): string {
  const raw = String(model ?? '').trim()
  return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
}

export function route(body: ChatRequestBody, config: SabiConfig): RouteDecision {
  const alias = normalizeAlias(body.model)
  const target = alias ? config.aliases[alias] : undefined
  if (!target) {
    throw new SabiRouteError(
      `unknown model '${String(body.model ?? '')}' — Sabi serves: ${Object.keys(config.aliases).join(', ')}`,
      404,
    )
  }
  const state = extractTrajectoryState(body)
  if (target !== 'auto') {
    const model = config.models[target]
    if (!model) throw new SabiRouteError(`alias '${alias}' targets unknown tier '${target}'`, 500)
    return {
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
  }
  const { rule, tier, reason } = decideTier(state, config.policy)
  const model = config.models[tier]
  if (!model) throw new SabiRouteError(`policy rule '${rule}' maps to unknown tier '${tier}'`, 500)
  return {
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
}
