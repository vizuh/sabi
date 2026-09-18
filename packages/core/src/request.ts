import type { ChatRequestBody, RouteDecision, SabiConfig } from './types.ts'

/**
 * Build the request that the proxy will actually send upstream.
 *
 * This is deliberately a pure shallow-envelope transform. Message/tool values
 * stay opaque and are never rewritten. Compatibility checks and dispatch must
 * use this same helper so generated fields cannot bypass the gate.
 */
export function buildEffectiveRequestEnvelope(
  config: SabiConfig,
  decision: RouteDecision,
  body: ChatRequestBody | Record<string, unknown>,
): Record<string, unknown> {
  const upstream = config.upstreams[decision.upstream]
  if (!upstream) throw new Error(`unknown upstream '${decision.upstream}'`)
  const next: Record<string, unknown> = { ...body, model: decision.upstreamModel }
  if (body.stream === true && upstream.streamUsage === true) {
    const candidate = body.stream_options
    const streamOptions = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {}
    if (streamOptions.include_usage !== true) {
      next.stream_options = { ...streamOptions, include_usage: true }
    }
  }
  return next
}
