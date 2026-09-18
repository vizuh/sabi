import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  appendDecision,
  applyJudge,
  buildJudgeState,
  defaultLogPath,
  estimateCost,
  JUDGE_QUESTIONS,
  judgeTriggers,
  route,
  SabiRouteError,
  sanitizeError,
  sanitizeReason,
  sessionIdFor,
  telemetryPolicy,
  type ChatRequestBody,
  type DecisionRecord,
  type JudgeRecord,
  type RouteDecision,
  type SabiConfig,
} from '@sabi/core'
import { createSseTap } from './sse.ts'
import { createTypesafeClient, type JudgeClient } from './typesafe.ts'
import { buildUpstreamBody, callUpstream, readErrorText, usageFromJson } from './upstream.ts'

const BODY_LIMIT = 32 * 1024 * 1024
const RECENT_LIMIT = 200

export interface SabiServerOptions {
  config: SabiConfig
  logFile?: string
  verbose?: boolean
  judgeClient?: JudgeClient
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
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string, type = 'sabi_error'): void {
  sendJson(res, status, { error: { message, type, code: status } })
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new SabiRouteError('request body too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function modelSummary(config: SabiConfig) {
  // Policy-reachable tiers: the tiers the auto alias can actually select. This is what a
  // provider writer should advertise; using every configured model (including `local`) made
  // the adaptive window differ from the reachable set.
  const reachable = new Set(
    Object.values(config.policy).filter((tier) => tier !== 'off' && config.models[tier]),
  )
  const contextWindowFor = (target: string): number | undefined => {
    if (target !== 'auto') return config.models[target]?.contextWindow
    const windows = [...reachable]
      .map((tier) => config.models[tier]?.contextWindow)
      .filter((value): value is number => typeof value === 'number' && value > 0)
    return windows.length ? Math.min(...windows) : undefined
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
  const state: ServerState = {
    options,
    logFile: options.logFile ?? defaultLogPath(),
    recent: [],
    judge: options.judgeClient ?? createTypesafeClient(),
    telemetry: telemetryPolicy(options.config.telemetry),
  }

  const server = createServer((req, res) => {
    handleRequest(state, req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        sendError(res, 500, `sabi internal error: ${(error as Error).message}`)
      } else {
        res.end()
      }
    })
  })

  server.requestTimeout = 0
  server.timeout = 0
  server.headersTimeout = 120_000
  server.keepAliveTimeout = 120_000

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

  let body: ChatRequestBody
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw.toString('utf8')) as ChatRequestBody
  } catch (error) {
    const status = error instanceof SabiRouteError ? error.status : 400
    sendError(res, status, `invalid request body: ${(error as Error).message}`)
    return
  }

  let decision: RouteDecision
  try {
    decision = route(body, config)
  } catch (error) {
    const status = error instanceof SabiRouteError ? error.status : 500
    sendError(res, status, (error as Error).message)
    return
  }

  let judgeRecord: JudgeRecord | undefined
  if (config.judge && judgeTriggers(decision, config.judge)) {
    const judgeState = buildJudgeState(body, decision, config.judge.maxStateChars)
    const judgeStarted = Date.now()
    try {
      const result = await state.judge.ask(judgeState, JUDGE_QUESTIONS, config.judge)
      const applied = applyJudge(decision, config, result.outcome)
      decision = applied.decision
      judgeRecord = { ...applied.record, latencyMs: result.latencyMs, cached: result.cached }
    } catch (error) {
      const name = (error as Error).name
      judgeRecord = {
        status: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'error',
        latencyMs: Date.now() - judgeStarted,
        note: sanitizeError(String((error as Error).message ?? error)).slice(0, 200),
      }
    }
  }

  const streamRequested = body.stream === true
  const record: DecisionRecord = {
    ts: new Date().toISOString(),
    sessionId: sessionIdFor(body),
    alias: decision.alias,
    mode: decision.mode,
    rule: decision.rule,
    tier: decision.tier,
    reason: sanitizeReason(decision.reason, state.telemetry),
    upstream: decision.upstream,
    upstreamModel: decision.upstreamModel,
    stream: streamRequested,
    state: decision.state,
    judge: judgeRecord,
    outcome: 'ok',
  }

  const finish = (patch: Partial<DecisionRecord>): void => {
    record.latencyMs = Date.now() - started
    Object.assign(record, patch)
    if (record.usage) {
      record.cost = estimateCost(record.usage, config.models[decision.model]?.cost)
    }
    appendDecision(record, state.logFile)
    state.recent.push(record)
    if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT)
    if (state.options.verbose !== false) {
      const cost = record.cost ? ` $${record.cost.total.toFixed(5)}` : ''
      const tokens = record.usage ? ` ${record.usage.promptTokens}in/${record.usage.completionTokens}out` : ''
      const judge = record.judge
        ? ` · jev ${record.judge.overridden ? `${record.judge.direction}->${record.judge.finalTier}` : record.judge.status}`
        : ''
      console.log(
        `[sabi] ${record.alias} -> ${decision.tier} (${decision.rule}) -> ${decision.upstreamModel}` +
          ` · ${record.latencyMs}ms${tokens}${cost}${judge}${record.outcome !== 'ok' ? ` · ${record.outcome}: ${record.error ?? ''}` : ''}`,
      )
    }
  }

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  let upstreamBody: Record<string, unknown>
  try {
    upstreamBody = buildUpstreamBody(config, decision, body)
  } catch (error) {
    sendError(res, 500, (error as Error).message)
    finish({ outcome: 'error', error: sanitizeError((error as Error).message) })
    return
  }

  let upstreamResponse: Response
  try {
    const call = await callUpstream(config, decision, upstreamBody, controller.signal)
    upstreamResponse = call.response
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? 'client aborted' : (error as Error).message
    const outcome = (error as Error).name === 'AbortError' ? 'aborted' : 'error'
    if (!res.headersSent) sendError(res, 502, `upstream ${decision.upstream} failed: ${message}`)
    finish({ outcome, error: message })
    return
  }

  if (!upstreamResponse.ok) {
    const text = await readErrorText(upstreamResponse)
    if (!res.headersSent) {
      res.writeHead(upstreamResponse.status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(text || JSON.stringify({ error: { message: `upstream error ${upstreamResponse.status}` } }))
    }
    // A 429/5xx from the provider is a transport error (rate limit / overload), not proof the
    // task is hard. Record it distinctly so reports can separate transport from task failure.
    const status = upstreamResponse.status
    const transport = status === 429 || (status >= 500 && status < 600)
    finish({ outcome: transport ? 'transport' : 'error', error: sanitizeError(text), transport: status })
    return
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? ''
  const streaming = streamRequested && contentType.includes('text/event-stream')

  if (!streaming) {
    const text = await upstreamResponse.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      if (!res.headersSent) {
        res.writeHead(200, { 'content-type': contentType || 'application/json' })
        res.end(text)
      }
      finish({ outcome: 'ok' })
      return
    }
    if (parsed && typeof parsed === 'object') {
      const object = parsed as Record<string, unknown>
      object.model = decision.alias
      const usage = usageFromJson(object)
      if (!res.headersSent) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(object))
      }
      finish(usage ? { usage } : {})
      return
    }
    if (!res.headersSent) {
      res.writeHead(200, { 'content-type': contentType || 'application/json' })
      res.end(text)
    }
    finish({ outcome: 'ok' })
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const bodyStream = upstreamResponse.body
  if (!bodyStream) {
    res.end()
    finish({ outcome: 'error', error: 'upstream returned no body' })
    return
  }

  let ttftMs: number | undefined
  const tap = createSseTap(decision.alias, (result) => {
    finish(result.usage ? { usage: result.usage, ttftMs } : { ttftMs })
  })

  const reader = bodyStream.getReader()
  let aborted = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (ttftMs === undefined) ttftMs = Date.now() - started
      const output = tap.push(value)
      if (output.length) {
        if (!res.write(output)) await once(res, 'drain')
      }
    }
    const tail = tap.flush()
    if (tail.length) res.write(tail)
  } catch (error) {
    aborted = (error as Error).name === 'AbortError' || controller.signal.aborted
  }
  if (!res.writableEnded) res.end()
  if (aborted) {
    finish({ outcome: 'aborted', error: 'client aborted' })
  }
}
