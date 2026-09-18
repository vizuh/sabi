import { resolveKey, type SabiConfig, type RouteDecision, type UsageTotals } from '@sabi/core'

export function joinUrl(baseURL: string, suffix: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

export interface UpstreamCall {
  response: Response
  url: string
  body: Record<string, unknown>
}

export function buildUpstreamBody(
  config: SabiConfig,
  decision: RouteDecision,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const upstream = config.upstreams[decision.upstream]
  if (!upstream) throw new Error(`unknown upstream '${decision.upstream}'`)
  const next: Record<string, unknown> = { ...body, model: decision.upstreamModel }
  if (body.stream === true && upstream.streamUsage === true) {
    const streamOptions = (body.stream_options as Record<string, unknown> | undefined) ?? {}
    if (streamOptions.include_usage !== true) {
      next.stream_options = { ...streamOptions, include_usage: true }
    }
  }
  return next
}

export interface UpstreamCallOptions {
  /** Opaque correlation id echoed to the upstream (and provider) for debugging/attribution. */
  requestId?: string
}

export async function callUpstream(
  config: SabiConfig,
  decision: RouteDecision,
  body: Record<string, unknown>,
  signal: AbortSignal,
  options: UpstreamCallOptions = {},
): Promise<UpstreamCall> {
  const upstream = config.upstreams[decision.upstream]
  if (!upstream) throw new Error(`unknown upstream '${decision.upstream}'`)
  const url = joinUrl(upstream.baseURL, 'chat/completions')
  // Sabi's own wiring takes precedence over anything a client could smuggle; client-supplied
  // routing/identity headers never reach the upstream (they convey identity, not permissions).
  const base = { ...(upstream.headers ?? {}) }
  delete base['x-sabi-request-id']
  delete base['x-sabi-session-id']
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: body.stream === true ? 'text/event-stream' : 'application/json',
    ...base,
  }
  if (options.requestId) headers['x-sabi-request-id'] = options.requestId
  const key = resolveKey(upstream.apiKey)
  if (key) headers.authorization = `Bearer ${key}`
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  return { response, url, body }
}

export function usageFromJson(value: unknown): UsageTotals | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = (value as Record<string, unknown>).usage
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const promptTokens = Number(record.prompt_tokens ?? 0) || 0
  const completionTokens = Number(record.completion_tokens ?? 0) || 0
  const details = record.prompt_tokens_details as Record<string, unknown> | undefined
  const cachedTokens = Number(details?.cached_tokens ?? 0) || 0
  const totalTokens = Number(record.total_tokens ?? 0) || promptTokens + completionTokens
  if (!promptTokens && !completionTokens) return undefined
  return { promptTokens, completionTokens, cachedTokens, totalTokens }
}

export async function readErrorText(response: Response, cap = 2000): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, cap)
  } catch {
    return ''
  }
}
