import type { IncomingMessage } from 'node:http'
import { buildEffectiveRequestEnvelope, resolveKey, SabiRouteError, type SabiConfig, type RouteDecision, type UsageTotals } from '@sabi/core'

export function joinUrl(baseURL: string, suffix: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

export interface UpstreamCall {
  response: Response
  url: string
  body: Record<string, unknown>
}

export const buildUpstreamBody = buildEffectiveRequestEnvelope

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
  // Routing metadata has no authentication or permission authority, even if configured here.
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith('x-sabi-')) delete headers[name]
  }
  const key = resolveKey(upstream.apiKey)
  if (key) headers.authorization = `Bearer ${key}`
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error', // A redirect must not replay the inference or forward credentials.
    headers,
    body: JSON.stringify(body),
    signal,
  })
  return { response, url, body }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class UpstreamProtocolError extends Error {
  constructor(message = 'invalid upstream response') {
    super(message)
    this.name = 'UpstreamProtocolError'
  }
}

export function chatResponseFromJson(value: unknown): Record<string, unknown> {
  if (!isObject(value) || !Array.isArray(value.choices) || !value.choices.length || value.error !== undefined) {
    throw new UpstreamProtocolError()
  }
  if (value.choices.some((choice) => !isObject(choice) || !isObject(choice.message) || choice.message.role !== 'assistant')) {
    throw new UpstreamProtocolError()
  }
  return value
}

export function usageFromJson(value: unknown): UsageTotals | undefined {
  if (!isObject(value) || !isObject(value.usage)) return undefined
  const usage = value.usage
  const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const promptTokens = usage.prompt_tokens
  const completionTokens = usage.completion_tokens
  // Missing or malformed usage is unknown, not a zero-token request.
  if (!validCount(promptTokens) || !validCount(completionTokens)) return undefined
  const details = usage.prompt_tokens_details
  if (details != null && !isObject(details)) return undefined
  const cachedTokens = isObject(details) ? details.cached_tokens ?? 0 : 0
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens
  if (!validCount(cachedTokens) || cachedTokens > promptTokens || !validCount(totalTokens)
    || totalTokens < promptTokens + completionTokens) return undefined
  return { promptTokens, completionTokens, cachedTokens, totalTokens }
}

/** Read bounded JSON/error bodies without buffering an unbounded upstream response. */
export async function readResponseText(response: Response, cap = 32 * 1024 * 1024, fatal = true): Promise<string> {
  if (!response.body) throw new UpstreamProtocolError('upstream returned no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > cap) throw new UpstreamProtocolError('upstream response too large')
      chunks.push(value)
    }
    // Success bodies stay strict (fatal): malformed bytes are a protocol violation. Error
    // bodies decode leniently — a provider 429 with a non-UTF-8 (e.g. Latin-1 HTML) page must
    // keep its status, Retry-After and transport classification instead of collapsing to 502.
    return new TextDecoder('utf-8', { fatal }).decode(Buffer.concat(chunks))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function readErrorText(response: Response, cap = 32 * 1024 * 1024): Promise<string> {
  if (!response.body) return ''
  return readResponseText(response, cap, false)
}

/** Largest request Sabi will buffer. An incomplete upload must not outlive the request deadline. */
export const BODY_LIMIT = 32 * 1024 * 1024

/** Bounded request read, shared by the OpenAI-compatible route and the borrowed-auth routes. */
export function readRequestBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      req.off('data', data)
      req.off('end', end)
      req.off('error', error)
      signal.removeEventListener('abort', abort)
    }
    const error = (reason: unknown) => { cleanup(); reject(reason) }
    const abort = () => error(signal.reason)
    const data = (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        error(new SabiRouteError('request body too large', 413))
        req.resume()
        return
      }
      chunks.push(chunk)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    req.on('data', data)
    req.on('end', end)
    req.on('error', error)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
