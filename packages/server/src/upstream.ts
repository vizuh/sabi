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

export async function callUpstream(
  config: SabiConfig,
  decision: RouteDecision,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<UpstreamCall> {
  const upstream = config.upstreams[decision.upstream]
  if (!upstream) throw new Error(`unknown upstream '${decision.upstream}'`)
  const url = joinUrl(upstream.baseURL, 'chat/completions')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: body.stream === true ? 'text/event-stream' : 'application/json',
    ...(upstream.headers ?? {}),
  }
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
