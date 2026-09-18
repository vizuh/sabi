import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  appendDecision,
  applyJudge,
  buildJudgeState,
  defaultLogPath,
  estimateCost,
  ensureRouteCompatible,
  hashIdentity,
  JUDGE_QUESTIONS,
  judgeTriggers,
  measuredContextTokens,
  route,
  SabiRouteError,
  sanitizeError,
  sanitizeReason,
  sessionIdFor,
  telemetryPolicy,
  type ChatRequestBody,
  type DecisionRecord,
  type JudgeRecord,
  type RouteContext,
  type RouteDecision,
  type SabiConfig,
} from '@sabi/core'
import { createSseTap, UpstreamStreamError, type SseTapResult } from './sse.ts'
import { createTypesafeClient, type JudgeClient } from './typesafe.ts'
import { buildUpstreamBody, callUpstream, chatResponseFromJson, isObject, readErrorText, readResponseText, UpstreamProtocolError, usageFromJson } from './upstream.ts'

const BODY_LIMIT = 32 * 1024 * 1024
const RECENT_LIMIT = 200

export interface SabiServerOptions {
  config: SabiConfig
  logFile?: string
  verbose?: boolean
  judgeClient?: JudgeClient
  /** Total wall-clock budget, including upload, judge and response stream. Default: 120 s. */
  requestTimeoutMs?: number
}

export interface SabiServer {
  server: Server
  recent: DecisionRecord[]
  listen(port: number, host: string): Promise<number>
  close(): Promise<void>
}

interface ServerState {
  options: SabiServerOptions
  logFile: string
  recent: DecisionRecord[]
  judge: JudgeClient
  telemetry: ReturnType<typeof telemetryPolicy>
  sessions: Map<string, SessionMemory>
}

interface SessionMemory {
  /** Host compactions observed for this session (a request that came back smaller). */
  generation: number
  /** Message count of the last request seen for this session. */
  messages: number
  /** Provider-billed total of the last completed round, when usage arrived. */
  tokens?: number
}

const SESSION_MEMORY_LIMIT = 512
/**
 * A host compaction rewrites the transcript before the next request, so the first request after
 * it is much smaller than the last one. Nothing else in a live session removes messages; half
 * the count (with a floor, so a short chat cannot trip it) is the conservative detector.
 */
const COMPACTION_MIN_MESSAGES = 8
const COMPACTION_SHRINK = 0.5

/**
 * What the previous rounds of this session measured. An unattributed request gets nothing:
 * without a session there is no continuity to claim, and borrowing another conversation's size
 * would be exactly the kind of guess the router refuses to make.
 */
function observeSession(
  state: ServerState,
  identity: Pick<DecisionRecord, 'sessionId' | 'sessionKnown'>,
  body: ChatRequestBody,
): RouteContext {
  const messages = Array.isArray(body.messages) ? body.messages.length : 0
  if (identity.sessionKnown !== true) return {}
  const memory = state.sessions.get(identity.sessionId)
  const compacted = memory !== undefined && memory.messages >= COMPACTION_MIN_MESSAGES &&
    messages > 0 && messages < memory.messages * COMPACTION_SHRINK
  const generation = (memory?.generation ?? 0) + (compacted ? 1 : 0)
  // Re-insert so the map's insertion order keeps tracking recency for eviction.
  state.sessions.delete(identity.sessionId)
  state.sessions.set(identity.sessionId, {
    generation,
    messages,
    // A compacted transcript invalidates the previous round's size — it described a context the
    // host has since removed. The next billed round re-establishes a measured floor.
    tokens: compacted ? undefined : memory?.tokens,
  })
  while (state.sessions.size > SESSION_MEMORY_LIMIT) {
    const oldest = state.sessions.keys().next().value
    if (oldest === undefined) break
    state.sessions.delete(oldest)
  }
  return {
    ...(compacted || memory?.tokens === undefined ? {} : { measuredContextTokens: memory.tokens }),
    ...(generation > 0 ? { contextGeneration: generation } : {}),
  }
}

function rememberUsage(state: ServerState, record: DecisionRecord): void {
  if (record.sessionKnown !== true) return
  const memory = state.sessions.get(record.sessionId)
  if (!memory) return
  const tokens = measuredContextTokens(record.usage)
  if (tokens !== undefined) memory.tokens = tokens
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string, type = 'sabi_error'): void {
  sendJson(res, status, { error: { message, type, code: status } })
}

const CLIENTS = new Set<DecisionRecord['client']>(['hermes', 'opencode', 'kilo-cli', 'kilo-vscode', 'prime-agent', 'unknown'])
const OPAQUE_ID = /^[A-Za-z0-9._:-]{1,128}$/

function requestIdentity(req: IncomingMessage): Pick<DecisionRecord, 'client' | 'sessionId' | 'sessionKnown' | 'requestId' | 'turnId'> {
  const header = (name: string): string | undefined => {
    const value = req.headers[name]
    // Node combines repeated non-special headers with commas; neither form is valid here.
    if (value !== undefined && (typeof value !== 'string' || !OPAQUE_ID.test(value))) {
      throw new SabiRouteError(`invalid ${name} header`)
    }
    return value
  }
  const rawClient = header('x-sabi-client') ?? 'unknown'
  if (!CLIENTS.has(rawClient as DecisionRecord['client'])) throw new SabiRouteError('invalid x-sabi-client header')
  const client = rawClient as NonNullable<DecisionRecord['client']>
  const session = header('x-sabi-session')
  const turn = header('x-sabi-turn')
  const sessionId = sessionIdFor(session, client)
  return {
    client,
    sessionId,
    sessionKnown: session !== undefined,
    requestId: randomUUID(),
    turnId: turn === undefined ? undefined : hashIdentity('turn', client, sessionId, turn),
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function readBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
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

function modelSummary(config: SabiConfig) {
  // Advertise a conservative window for both policy and optional judge decisions.
  // Unrelated configured models (for example `local`) do not constrain the auto alias.
  const reachable = new Set(
    Object.values(config.policy).filter((tier) => tier !== 'off' && config.models[tier]),
  )
  const fallback = config.policy.unclassified
  if ((!fallback || fallback === 'off' || !Object.hasOwn(config.models, fallback)) && Object.hasOwn(config.models, 'cheap')) {
    reachable.add('cheap')
  }
  if (config.judge?.enabled) {
    for (const tier of ['cheap', 'mid', 'strong']) {
      if (Object.hasOwn(config.models, tier)) reachable.add(tier)
    }
  }
  const contextWindowFor = (target: string): number | undefined => {
    if (target !== 'auto') return config.models[target]?.contextWindow
    const windows = [...reachable].map((tier) => config.models[tier]?.contextWindow)
    return windows.length && windows.every((value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0) ? Math.min(...windows) : undefined
  }
  return Object.entries(config.aliases).map(([id, target]) => ({
    id,
    object: 'model',
    created: 0,
    owned_by: 'sabi',
    context_window: contextWindowFor(target),
    sabi: { target, model: target === 'auto' ? 'adaptive' : config.models[target]?.model },
  }))
}

export function createSabiServer(options: SabiServerOptions): SabiServer {
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 2_147_483_647) {
    throw new Error('requestTimeoutMs must be a positive bounded integer')
  }
  const state: ServerState = {
    options,
    logFile: options.logFile ?? defaultLogPath(),
    recent: [],
    judge: options.judgeClient ?? createTypesafeClient(),
    telemetry: telemetryPolicy(options.config.telemetry),
    sessions: new Map(),
  }

  const server = createServer((req, res) => {
    handleRequest(state, req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        sendError(res, 500, 'sabi internal error')
      } else {
        res.end()
      }
    })
  })

  server.requestTimeout = requestTimeoutMs
  server.timeout = 0 // Active chat requests have a total deadline, not an idle timeout.
  server.headersTimeout = Math.min(requestTimeoutMs, 60_000)
  server.keepAliveTimeout = 5000

  return {
    server,
    recent: state.recent,
    listen(port: number, host: string): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          const address = server.address()
          resolve(typeof address === 'object' && address ? address.port : port)
        })
      })
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function handleRequest(state: ServerState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://sabi.local')
  const path = url.pathname

  if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
    await handleChat(state, req, res)
    return
  }
  if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
    sendJson(res, 200, { object: 'list', data: modelSummary(state.options.config) })
    return
  }
  if (req.method === 'GET' && path === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      models: Object.keys(state.options.config.aliases),
      upstreams: Object.keys(state.options.config.upstreams),
      log: state.logFile,
    })
    return
  }
  if (req.method === 'GET' && path === '/decisions') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, RECENT_LIMIT)
    const decisions = state.recent.slice(-limit)
    sendJson(res, 200, { count: decisions.length, decisions })
    return
  }
  sendError(res, 404, `no route for ${req.method} ${path}`, 'not_found')
}

async function handleChat(state: ServerState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now()
  const { config } = state.options
  const controller = new AbortController()
  const { signal } = controller
  const timeout = setTimeout(() => controller.abort(new DOMException('request deadline exceeded', 'TimeoutError')),
    state.options.requestTimeoutMs ?? 120_000)
  timeout.unref()
  const disconnected = () => {
    if (!res.writableFinished) controller.abort(new DOMException('client aborted', 'AbortError'))
  }
  req.once('aborted', disconnected)
  res.once('close', disconnected)
  let record: DecisionRecord | undefined
  let decision: RouteDecision | undefined
  let finished = false
  let stage: 'request' | 'route' | 'judge' | 'upstream' = 'request'
  const responseFinished = async () => {
    if (!res.writableFinished) await once(res, 'finish', { signal })
  }

  const finish = (patch: Partial<DecisionRecord>): void => {
    if (!record || finished) return
    finished = true
    record.latencyMs = Date.now() - started
    Object.assign(record, patch)
    if (record.usage && decision) {
      const served = record.servedModel && Object.values(config.models).find((model) =>
        model.upstream === decision?.upstream && model.model === record?.servedModel)
      // A requested backend is not evidence of which model actually served the tokens.
      record.cost = served ? estimateCost(record.usage, served.cost) : undefined
    }
    rememberUsage(state, record)
    appendDecision(record, state.logFile)
    state.recent.push(record)
    if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT)
    if (state.options.verbose !== false) {
      const cost = record.cost ? ` $${record.cost.total.toFixed(5)}` : ''
      const tokens = record.usage ? ` ${record.usage.promptTokens}in/${record.usage.completionTokens}out` : ''
      console.log(`[sabi] ${record.alias} -> ${record.tier} (${record.rule}) -> ${record.upstreamModel}` +
        ` · ${record.latencyMs}ms${tokens}${cost} · ${record.outcome}`)
    }
  }
  const observeModel = (model: unknown): string | undefined =>
    typeof model === 'string' && Object.values(config.models).some((entry) =>
      entry.upstream === decision?.upstream && entry.model === model) ? model : undefined
  const saveDecision = (next: RouteDecision): void => {
    if (!record) return
    Object.assign(record, {
      alias: next.alias, mode: next.mode, rule: next.rule, tier: next.tier,
      reason: sanitizeReason(next.reason, state.telemetry), upstream: next.upstream, upstreamModel: next.upstreamModel,
      state: {
        ...next.state,
        // Tool identities can contain arbitrary private text; classification still uses originals.
        toolNames: next.state.toolNames.map((name) => hashIdentity('tool', name)),
        lastToolNames: next.state.lastToolNames.map((name) => hashIdentity('tool', name)),
        lastRole: ['system', 'developer', 'user', 'assistant', 'tool', 'function'].includes(next.state.lastRole)
          ? next.state.lastRole : 'unknown',
      },
    })
  }

  try {
    const identity = requestIdentity(req)
    res.setHeader('x-sabi-request-id', identity.requestId!)
    const raw = await readBody(req, signal)
    let parsed: unknown
    try { parsed = JSON.parse(raw.toString('utf8')) } catch { throw new SabiRouteError('invalid request body') }
    if (!isObject(parsed) || !Array.isArray(parsed.messages) || !parsed.messages.length ||
      parsed.messages.some((message) => !isObject(message) || typeof message.role !== 'string')) {
      throw new SabiRouteError('invalid request body')
    }
    const body = parsed as ChatRequestBody
    stage = 'route'
    decision = route(body, config, observeSession(state, identity, body))
    record = {
      ts: new Date().toISOString(), ...identity,
      alias: decision.alias, mode: decision.mode, rule: decision.rule, tier: decision.tier,
      reason: '', upstream: decision.upstream, upstreamModel: decision.upstreamModel,
      stream: body.stream === true, state: decision.state, outcome: 'ok',
    }
    saveDecision(decision)

    let judgeRecord: JudgeRecord | undefined
    stage = 'judge'
    if (decision.mode === 'auto' && config.judge && judgeTriggers(decision, config.judge)) {
      const judgeState = buildJudgeState(body, decision, config.judge.maxStateChars)
      const judgeStarted = Date.now()
      try {
        const result = await abortable(state.judge.ask(judgeState, JUDGE_QUESTIONS, config.judge, signal), signal)
        const applied = applyJudge(decision, config, result.outcome)
        decision = applied.decision
        judgeRecord = {
          ...applied.record,
          // The judge's arbitrary response model is not a trusted telemetry identifier.
          model: config.judge.model ?? 'jev-latest',
          latencyMs: result.latencyMs, cached: result.cached,
        }
      } catch (error) {
        if (signal.aborted) throw signal.reason
        const name = (error as Error).name
        judgeRecord = {
          status: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'error',
          latencyMs: Date.now() - judgeStarted,
          note: 'typesafe unavailable',
        }
      }
    }
    record.judge = judgeRecord
    saveDecision(decision)
    stage = 'route'
    // Jev may change the selected tier. It must not bypass the shared compatibility gate.
    ensureRouteCompatible(body, config, decision)
    signal.throwIfAborted()
    stage = 'upstream'
    const upstreamBody = buildUpstreamBody(config, decision, body)
    const { response: upstreamResponse } = await callUpstream(config, decision, upstreamBody, signal)

    if (!upstreamResponse.ok) {
      const text = await readErrorText(upstreamResponse)
      const status = upstreamResponse.status
      const headers: Record<string, string> = { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8' }
      const retryAfter = upstreamResponse.headers.get('retry-after')
      if (retryAfter !== null) headers['retry-after'] = retryAfter
      res.writeHead(status, headers)
      res.end(text || JSON.stringify({ error: { message: `upstream error ${status}` } }))
      await responseFinished()
      finish({ outcome: status === 429 || status >= 500 ? 'transport' : 'error',
        error: `upstream HTTP ${status}`, transport: status })
      return
    }

    const streaming = (upstreamResponse.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')
    if (streaming !== (body.stream === true)) {
      await upstreamResponse.body?.cancel()
      throw new UpstreamProtocolError('upstream response mode mismatch')
    }
    if (!streaming) {
      const text = await readResponseText(upstreamResponse)
      let value: unknown
      try { value = JSON.parse(text) } catch { throw new UpstreamProtocolError() }
      const object = chatResponseFromJson(value)
      const servedModel = observeModel(object.model)
      object.model = decision.alias
      sendJson(res, 200, object)
      await responseFinished()
      finish({ usage: usageFromJson(object), servedModel })
      return
    }

    if (!upstreamResponse.body) throw new UpstreamProtocolError('upstream returned no body')
    const streamHeaders = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
    }
    let ttftMs: number | undefined
    let streamResult: SseTapResult | undefined
    const tap = createSseTap(decision.alias, (result) => { streamResult = result })
    const reader = upstreamResponse.body.getReader()
    const write = async (output: Uint8Array) => {
      if (!output.length) return
      signal.throwIfAborted()
      if (!res.headersSent) res.writeHead(200, streamHeaders)
      if (!res.write(output)) await once(res, 'drain', { signal })
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (ttftMs === undefined) ttftMs = Date.now() - started
        await write(tap.push(value))
        // [DONE] ends this attempt even if the provider keeps its socket open.
        if (tap.done) break
      }
      await write(tap.flush())
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    res.end()
    await responseFinished()
    finish({ usage: streamResult?.usage, servedModel: observeModel(streamResult?.model), ttftMs })
  } catch (error) {
    const deadline = signal.aborted && (signal.reason as Error)?.name === 'TimeoutError'
    const aborted = signal.aborted && !deadline
    const status = deadline ? 504 : error instanceof SabiRouteError ? error.status : stage === 'upstream' ? 502 : 500
    const message = deadline ? 'request deadline exceeded' : aborted ? 'client aborted' :
      error instanceof SabiRouteError ? error.message : stage === 'upstream' ? 'invalid or failed upstream response' : 'sabi internal error'
    if (!res.destroyed && !res.writableFinished) {
      if (res.headersSent || aborted) res.destroy()
      else {
        // An incomplete upload must not outlive its failed request budget.
        if (!req.complete) res.setHeader('connection', 'close')
        sendError(res, status, message)
      }
    }
    finish({ outcome: deadline ? 'transport' : aborted ? 'aborted' : 'error',
      error: deadline ? 'request deadline exceeded' : aborted ? 'client aborted' :
        // The client-facing message stays generic; the log keeps the provider's own explanation
        // (sanitized, first line, ≤200 chars) so a mid-stream 402 is diagnosable from the report.
        stage !== 'upstream' ? 'route rejected' :
          error instanceof UpstreamStreamError ? sanitizeError(error.providerMessage) : 'upstream response failed',
      ...(deadline ? { transport: 504 } : {}),
    })
    if (!signal.aborted) controller.abort()
  } finally {
    clearTimeout(timeout)
    req.off('aborted', disconnected)
    res.off('close', disconnected)
  }
}
