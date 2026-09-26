import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  appendDecision,
  ensureRouteCompatible,
  hashIdentity,
  passthroughAlias,
  route,
  SabiRouteError,
  sanitizeReason,
  telemetryPolicy,
  type ChatRequestBody,
  type DecisionRecord,
  type ModelEntry,
  type RouteDecision,
  type SabiConfig,
} from '@sabi/core'
import { isObject, joinUrl, readRequestBody } from './upstream.ts'

/**
 * Borrowed harness authentication.
 *
 * Sabi sits between the harness and the model. The harness keeps its own credential and keeps
 * sending it; Sabi decides which model serves the round and forwards the request with the
 * credential it received, to the provider that credential belongs to. No credential file is
 * opened, nothing is written to disk, and nothing is sent anywhere the harness would not have
 * sent it itself.
 *
 * The incoming body is the harness's native wire format, so each format supplies a small adapter:
 * a faithful view for the round classifier, the provider's request path, and the protocol headers
 * the provider needs. Everything after that is the same policy that serves the OpenAI route.
 */

export type PassthroughFormat = 'anthropic' | 'responses'

interface FormatAdapter {
  /** Path appended to the upstream baseURL. */
  path: string
  /** Provider protocol headers worth forwarding, beside the credential. */
  protocolHeaders: readonly string[]
  /** Map the harness's body onto the shape the round classifier already understands. */
  view(body: Record<string, unknown>, alias: string): ChatRequestBody | undefined
}

/** Credentials travel in exactly these; a provider that wants something else is not supported yet. */
const CREDENTIAL_HEADERS = ['authorization', 'x-api-key'] as const
const COMMON_HEADERS = ['content-type', 'accept'] as const

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') { parts.push(block); continue }
    if (!isObject(block)) continue
    const text = block.text
    if (typeof text === 'string') { parts.push(text); continue }
    // A tool result is where a coding agent's evidence actually lives: an error, a failing test, a
    // stack trace. Dropping it would leave the classifier routing on prompts alone, which is the
    // one thing this route exists to avoid.
    if (block.type === 'tool_result' && block.content !== undefined) {
      parts.push(textOf(block.content))
      continue
    }
    // A tool call is trajectory evidence too: what the agent reached for, and with what.
    if (block.type === 'tool_use' && typeof block.name === 'string') parts.push(`tool_use: ${block.name}`)
  }
  return parts.filter((part) => part.length > 0).join('\n')
}

function toolNames(tools: unknown): Array<{ type: 'function'; function: { name: string } }> | undefined {
  if (!Array.isArray(tools)) return undefined
  const named = tools.flatMap((tool) => isObject(tool) && typeof tool.name === 'string'
    ? [{ type: 'function' as const, function: { name: tool.name } }]
    : [])
  return named.length ? named : undefined
}

/**
 * Anthropic Messages: `system` is its own field, content is a string or a block array, and tools
 * carry `input_schema`. Only what the classifier reads is translated — the forwarded body is the
 * harness's own, untouched apart from `model`.
 */
const anthropic: FormatAdapter = {
  path: 'v1/messages',
  protocolHeaders: ['anthropic-version', 'anthropic-beta'],
  view(body, alias) {
    const messages = body.messages
    if (!Array.isArray(messages) || !messages.length) return undefined
    const view: Array<Record<string, unknown>> = []
    const system = textOf(body.system)
    if (system) view.push({ role: 'system', content: system })
    for (const message of messages) {
      if (!isObject(message) || typeof message.role !== 'string') return undefined
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      const content = message.content
      if (typeof content === 'string') { view.push({ role, content }); continue }
      if (!Array.isArray(content)) { view.push({ role, content: '' }); continue }
      const texts: string[] = []
      const calls: Array<{ type: 'function'; function: { name: string; arguments: string } }> = []
      for (const block of content) {
        if (typeof block === 'string') { texts.push(block); continue }
        if (!isObject(block)) continue
        if (typeof block.text === 'string') { texts.push(block.text); continue }
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          calls.push({ type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } })
          continue
        }
        // A tool result is its own message in the OpenAI shape: the classifier reads contiguous
        // trailing tool messages for failure evidence, so folding a result into the user turn that
        // carried it would hide exactly the evidence this route routes on.
        if (block.type === 'tool_result') view.push({ role: 'tool', content: textOf(block.content) })
      }
      if (calls.length) view.push({ role: 'assistant', content: texts.join('\n'), tool_calls: calls })
      else if (texts.length) view.push({ role, content: texts.join('\n') })
    }
    const tools = toolNames(body.tools)
    return {
      model: alias,
      messages: view,
      ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
      ...(tools ? { tools } : {}),
      ...(body.stream === true ? { stream: true } : {}),
    } as ChatRequestBody
  },
}

/**
 * OpenAI Responses: `input` replaces `messages` and `instructions` replaces the system prompt.
 * Items are either bare strings or role-tagged objects.
 */
const responses: FormatAdapter = {
  path: 'responses',
  protocolHeaders: ['openai-beta', 'openai-organization', 'session_id'],
  view(body, alias) {
    const input = body.input
    if (!Array.isArray(input) || !input.length) return undefined
    const view: Array<{ role: string; content: string }> = []
    const instructions = typeof body.instructions === 'string' ? body.instructions : ''
    if (instructions) view.push({ role: 'system', content: instructions })
    for (const item of input) {
      if (typeof item === 'string') { view.push({ role: 'user', content: item }); continue }
      if (!isObject(item)) return undefined
      const role = typeof item.role === 'string' ? item.role : undefined
      if (!role) continue
      view.push({ role: role === 'assistant' ? 'assistant' : 'user', content: textOf(item.content) })
    }
    if (!view.length) return undefined
    const tools = toolNames(body.tools)
    return {
      model: alias,
      messages: view,
      ...(typeof body.max_output_tokens === 'number' ? { max_completion_tokens: body.max_output_tokens } : {}),
      ...(tools ? { tools } : {}),
      ...(body.stream === true ? { stream: true } : {}),
    } as ChatRequestBody
  },
}

const FORMATS: Record<PassthroughFormat, FormatAdapter> = { anthropic, responses }

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  if (typeof raw === 'string' && raw.trim()) return raw
  if (Array.isArray(raw) && raw.length && typeof raw[0] === 'string' && raw[0].trim()) return raw[0]
  return undefined
}

/** The credential is forwarded, never inspected, and never leaves the process. */
function forwardedHeaders(req: IncomingMessage, adapter: FormatAdapter): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of [...COMMON_HEADERS, ...CREDENTIAL_HEADERS, ...adapter.protocolHeaders]) {
    const value = headerValue(req, name)
    if (value) headers[name] = value
  }
  headers['content-type'] = 'application/json'
  return headers
}

function hasCredential(headers: Record<string, string>): boolean {
  return CREDENTIAL_HEADERS.some((name) => Boolean(headers[name]))
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function refuse(res: ServerResponse, status: number, message: string): undefined {
  sendJson(res, status, { error: { message, type: 'sabi_error', code: status } })
  return undefined
}

export interface PassthroughDeps {
  config: SabiConfig
  logFile?: string
  recent: DecisionRecord[]
  /** Identity fields the OpenAI route already computes from the request headers. */
  identity: Pick<DecisionRecord, 'client' | 'sessionId' | 'sessionKnown' | 'requestId' | 'turnId'>
}

function recordOf(deps: PassthroughDeps, decision: RouteDecision, body: Record<string, unknown>, started: number): DecisionRecord {
  return {
    ts: new Date().toISOString(),
    ...deps.identity,
    alias: decision.alias,
    mode: decision.mode,
    rule: decision.rule,
    tier: decision.tier,
    reason: sanitizeReason(decision.reason, telemetryPolicy(deps.config.telemetry)),
    upstream: decision.upstream,
    upstreamModel: decision.upstreamModel,
    stream: body.stream === true,
    state: {
      ...decision.state,
      toolNames: decision.state.toolNames.map((name) => hashIdentity('tool', name)),
    },
    outcome: 'ok',
    latencyMs: Date.now() - started,
  }
}

/**
 * Serve one borrowed round. Returns the decision record it appended, or undefined when the request
 * was refused before dispatch.
 */
export async function handlePassthrough(
  deps: PassthroughDeps,
  req: IncomingMessage,
  res: ServerResponse,
  format: PassthroughFormat,
  signal: AbortSignal,
): Promise<DecisionRecord | undefined> {
  const { config } = deps
  const adapter = FORMATS[format]
  const started = Date.now()
  const alias = passthroughAlias(config)
  if (!alias || config.aliases[alias] !== 'auto') {
    return refuse(res, 500, 'no adaptive alias is configured for borrowed rounds')
  }

  const raw = await readRequestBody(req, signal)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    return refuse(res, 400, 'invalid request body')
  }
  if (!isObject(parsed)) return refuse(res, 400, 'invalid request body')
  const body = parsed
  const view = adapter.view(body, alias)
  if (!view) return refuse(res, 400, `request body is not a valid ${format} request`)

  const headers = forwardedHeaders(req, adapter)
  if (!hasCredential(headers)) {
    // Sabi holds no credential for this upstream by design, so there is nothing to fall back to.
    return refuse(res, 401, 'no credential on the request: a borrowed upstream forwards the credential the harness sent')
  }

  // A borrowed round routes on its own tier set when one is declared, so wiring a passthrough
  // upstream never repoints the shared cheap/mid/strong tiers every OpenAI-compatible harness
  // routes through. Absent config.passthrough.models, this is `config` itself — same object,
  // current behavior unchanged.
  const routingConfig: SabiConfig = config.passthrough?.models
    ? { ...config, models: config.passthrough.models, policy: config.passthrough.policy ?? config.policy }
    : config
  const decision = route(view, routingConfig, {})
  const entry: ModelEntry | undefined = Object.hasOwn(routingConfig.models, decision.tier) ? routingConfig.models[decision.tier] : undefined
  if (!entry) return refuse(res, 500, `policy rule '${decision.rule}' maps to unknown tier '${decision.tier}'`)
  const upstream = config.upstreams[entry.upstream]
  if (!upstream || upstream.auth !== 'passthrough') {
    return refuse(res, 400,
      `tier '${decision.tier}' is served by upstream '${entry.upstream}', which does not borrow authentication; ` +
      'a borrowed round needs an upstream declared with auth:passthrough')
  }
  ensureRouteCompatible(view, routingConfig, decision)

  const url = joinUrl(upstream.baseURL, adapter.path)
  const upstreamResponse = await fetch(url, {
    method: 'POST',
    redirect: 'error', // A redirect must not replay the inference or forward a borrowed credential.
    headers: { ...headers, ...(upstream.headers ?? {}) },
    body: JSON.stringify({ ...body, model: entry.model }),
    signal,
  })

  const record = recordOf(deps, decision, body, started)
  if (!upstreamResponse.ok) {
    record.outcome = upstreamResponse.status === 429 || upstreamResponse.status >= 500 ? 'transport' : 'error'
    record.error = `upstream HTTP ${upstreamResponse.status}`
    if (upstreamResponse.status === 429 || upstreamResponse.status >= 500) record.transport = upstreamResponse.status
  }
  appendDecision(record, deps.logFile)
  deps.recent.push(record)

  const contentType = (upstreamResponse.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.includes('text/event-stream')) {
    const text = await upstreamResponse.text()
    res.writeHead(upstreamResponse.status, {
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
    })
    res.end(text)
    return record
  }

  // Streaming is forwarded frame-by-frame: the harness's client parses its own protocol, and a
  // re-framed stream would be a different protocol than the one it asked for.
  res.writeHead(upstreamResponse.status, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  if (upstreamResponse.body) {
    const reader = upstreamResponse.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.length) continue
        if (!res.write(value)) await once(res, 'drain', { signal })
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  res.end()
  return record
}

export { SabiRouteError }
