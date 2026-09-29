import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  appendDecision,
  applyJudge,
  buildJudgeState,
  cacheObservationFromUsage,
  defaultLogPath,
  estimateCost,
  ensureRouteCompatible,
  getFallbackChain,
  hashIdentity,
  isFreeModel,
  JUDGE_QUESTIONS,
  judgeTriggers,
  keyReferenceName,
  loadRecovery,
  readDecisions,
  measuredContextTokens,
  observeEffort,
  resolveKey,
  route,
  SabiRouteError,
  sanitizeError,
  sanitizeReason,
  scheduleEffort,
  sessionIdFor,
  telemetryPolicy,
  type ChatRequestBody,
  type CacheObservation,
  type DecisionRecord,
  type FailureLevel,
  type JudgeRecord,
  type RecoveryProfile,
  type RefusalClass,
  type RouteContext,
  type RouteDecision,
  type RouteReceipt,
  type RouteSide,
  type SabiConfig,
  type UpstreamRefusal,
  quotaPoolOf,
  unresolvedKeyReference,
} from '@sabi/core'
import { DASHBOARD_WINDOWS, renderDashboard } from './dashboard.ts'
import { createSseTap, UpstreamStreamError, type SseTapResult } from './sse.ts'
import { handlePassthrough, type PassthroughFormat } from './passthrough.ts'
import { createTypesafeClient, type JudgeClient } from './typesafe.ts'
import { borrowedCredential, buildUpstreamBody, callUpstream, chatResponseFromJson, isObject, readErrorText, readRequestBody, readResponseText, UpstreamProtocolError, usageFromJson } from './upstream.ts'

const RECENT_LIMIT = 200

/**
 * Startup credential labels that never echo configured values. A literal key
 * pasted into `apiKey` must not end up on the terminal (and from there in a
 * pasted log), so only the config field name — plus the referenced env var
 * when the reference itself is valid — is reported.
 */
export function credentialWarnings(config: SabiConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = []
  for (const [name, upstream] of Object.entries(config.upstreams)) {
    if (upstream.apiKey === false) continue
    try {
      if (resolveKey(upstream.apiKey, env)) continue
      const reference = keyReferenceName(upstream.apiKey)
      warnings.push(reference ? `${name} ($${reference} is not set)` : `${name} (apiKey is not configured)`)
    } catch {
      warnings.push(`${name} (unsupported apiKey reference; use "$ENV_VAR" or false)`)
    }
  }
  const judge = config.judge
  if (judge?.enabled) {
    try {
      if (!resolveKey(judge.apiKey, env)) {
        const reference = keyReferenceName(judge.apiKey)
        warnings.push(reference ? `judge ($${reference} is not set)` : 'judge (apiKey is not configured)')
      }
    } catch {
      warnings.push('judge (unsupported apiKey reference; use "$ENV_VAR" or false)')
    }
  }
  return warnings
}

export interface SabiServerOptions {
  config: SabiConfig
  logFile?: string
  verbose?: boolean
  judgeClient?: JudgeClient
  /** Total wall-clock budget, including upload, judge and response stream. Default: 120 s. */
  requestTimeoutMs?: number
  /**
   * Shadow mirror sink (spec 010 T041). Present only when mirroring is on. The server
   * never reads the on/off state itself: the controller owns `.sabi/shadow.json` and
   * passes a sink in. A sink failure must never fail a round, so callers get a
   * fail-open contract.
   */
  shadow?: ShadowSink
}

/** Mirror sink: observes a completed decision, never influences it. */
export interface ShadowSink {
  observe(record: DecisionRecord): void
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
  /** Upstream model pairs this account's plan refused, with the time the refusal expires. */
  notEntitled: Map<string, number>
  /** Loaded once at startup (never inside a request); undefined if the load failed. */
  recoveryProfile?: RecoveryProfile
}

interface SessionMemory {
  /** Host compactions observed for this session (a request that came back smaller). */
  generation: number
  /** Message count of the last request seen for this session. */
  messages: number
  /** Provider-billed total of the last completed round, when usage arrived. */
  tokens?: number
  /** Failure level of the last routed round, for stuck (repeated-failure) detection. */
  lastFailure?: FailureLevel
  /** Repeated-failure depth flag (1 = first hard round, 2 = repeated), matching the harness. */
  failureStreak?: number
  /** Last Sabi route and role, used only for bounded model affinity. */
  lastTier?: string
  lastRoundKind?: RouteContext['previousRoundKind']
  lastLastRole?: string
  cache?: CacheObservation
  /**
   * Pre-shrink message count of an unconfirmed compaction candidate. A single small
   * request can also be a second consumer reusing the same session identity with a
   * smaller transcript, so the generation only advances when the shrink persists on
   * the next request for the same session.
   */
  pendingBaseline?: number
}

const SESSION_MEMORY_LIMIT = 512
/**
 * A host compaction rewrites the transcript before the next request, so the first request after
 * it is much smaller than the last one. Nothing else in a single live session removes messages;
 * half the count (with a floor, so a short chat cannot trip it) is the conservative detector.
 * Two consumers can still share one session identity string, so one small request only arms a
 * candidate: the shrink must still hold on the next request before it counts as a compaction.
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
  const shrunkFrom = (baseline: number): boolean =>
    baseline >= COMPACTION_MIN_MESSAGES && messages > 0 && messages < baseline * COMPACTION_SHRINK
  // A pending candidate is confirmed only while the transcript stays small against the same
  // pre-shrink baseline. A recovery to the old size means the small request was a different
  // consumer sharing the session identity, not a host rewrite — drop the candidate fail-open.
  const pending = memory?.pendingBaseline
  const compacted = pending !== undefined
    ? shrunkFrom(pending)
    : (memory !== undefined && shrunkFrom(memory.messages))
  const confirmed = pending !== undefined && compacted
  const armed = pending === undefined && compacted
  const generation = (memory?.generation ?? 0) + (confirmed ? 1 : 0)
  // Re-insert so the map's insertion order keeps tracking recency for eviction.
  state.sessions.delete(identity.sessionId)
  state.sessions.set(identity.sessionId, {
    generation,
    messages,
    // A confirmed transcript invalidates the previous round's size — it described a context
    // the host has since removed. An unconfirmed small request keeps the measured floor: the
    // next billed round re-establishes it when the shrink turns out to be real.
    tokens: confirmed ? undefined : memory?.tokens,
    // A rewrite also restarts the failure streak: the earlier failure is not the attempt the
    // model is continuing. Unattributed requests never carry a previous failure.
    lastFailure: confirmed ? undefined : memory?.lastFailure,
    failureStreak: confirmed ? undefined : memory?.failureStreak,
    lastTier: confirmed ? undefined : memory?.lastTier,
    lastRoundKind: confirmed ? undefined : memory?.lastRoundKind,
    lastLastRole: confirmed ? undefined : memory?.lastLastRole,
    cache: confirmed ? undefined : memory?.cache,
    // Keep the original baseline while a candidate is armed so the next request is judged
    // against the same pre-shrink size; clear it once the candidate confirms or recovers.
    ...(armed ? { pendingBaseline: memory?.messages } : {}),
  })
  while (state.sessions.size > SESSION_MEMORY_LIMIT) {
    const oldest = state.sessions.keys().next().value
    if (oldest === undefined) break
    state.sessions.delete(oldest)
  }
  const previous = confirmed ? undefined : memory
  return {
    ...(confirmed || memory?.tokens === undefined ? {} : { measuredContextTokens: memory.tokens }),
    ...(generation > 0 ? { contextGeneration: generation } : {}),
    ...(previous?.lastFailure !== undefined ? {
      previousFailure: previous.lastFailure,
      ...(previous.failureStreak !== undefined ? { previousFailureStreak: previous.failureStreak } : {}),
    } : {}),
    ...(previous?.lastTier !== undefined ? {
      previousTier: previous.lastTier,
      previousRoundKind: previous.lastRoundKind,
      previousLastRole: previous.lastLastRole,
      previousGeneration: previous.generation,
      ...(previous.cache ? { previousCache: previous.cache } : {}),
    } : {}),
  }
}

/** Persist this round's failure outcome so the next identified round can detect a streak. */
function rememberFailure(state: ServerState, record: DecisionRecord): void {
  if (record.sessionKnown !== true) return
  const memory = state.sessions.get(record.sessionId)
  if (!memory) return
  memory.lastFailure = record.state.failure
  memory.failureStreak = record.state.failureStreak ?? 0
  memory.lastTier = record.fallback ?? record.tier
  memory.lastRoundKind = record.state.roundKind
  memory.lastLastRole = record.state.lastRole
}

function rememberUsage(state: ServerState, record: DecisionRecord): void {
  if (record.sessionKnown !== true) return
  const memory = state.sessions.get(record.sessionId)
  if (!memory) return
  const tokens = measuredContextTokens(record.usage)
  if (tokens !== undefined) memory.tokens = tokens
  memory.cache = cacheObservationFromUsage(record.usage)
}

/**
 * OpenRouter documents that its own platform limits, including the shared free-model
 * caps, carry X-RateLimit-* headers; a 429 relayed from one model's provider does not.
 * Only the former is a statement about a whole quota pool.
 */
function platformRateLimited(response: Response): boolean {
  return response.status === 429 &&
    (response.headers.has('x-ratelimit-limit') || response.headers.has('x-ratelimit-remaining'))
}

/**
 * A plan that does not include a model says so in the body; the status alone does not (a
 * bare 402 is usually account credit, which a top-up fixes). Only wording seen in the wild
 * counts, from NousResearch/hermes-agent#123362: "model is not available in the current token plan".
 */
// ponytail: one observed phrasing, matched whole; add another provider's wording only with a cited example.
const NOT_ENTITLED = /model is not available in the current token plan/i
/** How long a not-entitled refusal is remembered. A plan change needs a restart or waits this out. */
const NOT_ENTITLED_TTL_MS = 6 * 60 * 60 * 1000

/** `keySent` separates a rejected key from a keyless upstream that turned out to need one. */
function refusalClass(status: number, text: string, platformLimited: boolean, keySent: boolean): RefusalClass {
  if (status === 401 && keySent) return 'credential'
  if ((status === 402 || status === 403) && NOT_ENTITLED.test(text)) return 'not-entitled'
  return platformLimited ? 'quota' : 'transient'
}

const entitlementKey = (upstream: string, model: string): string => `${upstream}\n${model}`

function refusedByPlan(state: ServerState, upstream: string, model: string): boolean {
  const key = entitlementKey(upstream, model)
  const until = state.notEntitled.get(key)
  if (until === undefined) return false
  if (until > Date.now()) return true
  state.notEntitled.delete(key)
  return false
}

/**
 * A refusal known before calling: the key variable is unset, or the plan refused this model
 * within the TTL. A borrowed credential is another account, so neither applies to it.
 */
function knownRefusal(state: ServerState, upstream: string, model: string, callerToken: string | undefined): RefusalClass | undefined {
  if (callerToken) return undefined
  if (unresolvedKeyReference(state.options.config.upstreams[upstream]) !== undefined) return 'unconfigured'
  return refusedByPlan(state, upstream, model) ? 'not-entitled' : undefined
}

function rememberRefusal(state: ServerState, refusal: RefusalClass, upstream: string, model: string, callerToken: string | undefined): void {
  if (refusal === 'not-entitled' && !callerToken) state.notEntitled.set(entitlementKey(upstream, model), Date.now() + NOT_ENTITLED_TTL_MS)
}

/**
 * First chunk of an error body, then release it. Enough to classify a refusal without waiting
 * on a provider that stalls after its first bytes; one that sends no body bytes at all still
 * waits, bounded by the request deadline.
 */
// ponytail: first chunk only; a refusal worded in a later chunk stays transient, and the client
// is served that chunk. Race the read against a short timer if zero-byte stalls show up.
async function readErrorHead(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  try {
    const { value } = await reader.read()
    return value ? new TextDecoder().decode(value.subarray(0, 64 * 1024)) : ''
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string, type = 'sabi_error'): void {
  sendJson(res, status, { error: { message, type, code: status } })
}

/**
 * Loopback origin boundary. The proxy is a local-only server: it must never act on a
 * cross-origin request, and read-only surfaces must not be reachable from a rebound
 * origin. Legitimate harness clients are non-browser (no `Origin`) or loopback, so
 * rejecting anything else breaks no documented flow. Fail-closed here: unlike routing
 * (which fails open to the deterministic policy), a forbidden origin is never executed.
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (typeof host !== 'string' || !host.trim()) return false
  const raw = host.trim().toLowerCase()
  let hostname: string
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end <= 1) return false
    hostname = raw.slice(1, end)
  } else if (raw.split(':').length === 2) {
    hostname = raw.split(':')[0] ?? ''
  } else if (raw.includes(':')) {
    hostname = raw // bare IPv6 literal without a port (e.g. ::1)
  } else {
    hostname = raw
  }
  return hostname === '127.0.0.1' || hostname === 'localhost' ||
    hostname === '::1' || hostname === '::ffff:127.0.0.1'
}

/** Absent means a non-browser client (allowed); present must be a loopback origin. */
function isAllowedOrigin(value: string | undefined): boolean {
  if (value === undefined) return true
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null') return false
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function originViolation(req: IncomingMessage): string | undefined {
  if (!isLoopbackHost(req.headers.host)) return 'forbidden host'
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin.join(',') : req.headers.origin
  if (!isAllowedOrigin(origin)) return 'forbidden origin'
  const referer = Array.isArray(req.headers.referer) ? req.headers.referer.join(',') : req.headers.referer
  if (referer !== undefined && !isAllowedOrigin(referer)) return 'forbidden origin'
  return undefined
}

const CLIENTS = new Set<DecisionRecord['client']>(['hermes', 'opencode', 'kilo-cli', 'kilo-vscode', 'prime-agent', 'deepseek-harness', 'command-code', 'sabi-surplus', 'unknown'])
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
  return Object.entries(config.aliases)
    // The advertised list is the product surface, and it is deliberately
    // small. A client that renders every alias turns Sabi back into a model
    // picker, which is the thing Sabi was built to stop being. Diagnostic
    // tiers stay routable by name for an operator who already knows them.
    .filter(([, target]) => {
      if (target === 'auto') return true
      return config.models[target]?.visibility !== 'diagnostic'
    })
    .map(([id, target]) => ({
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
  const logFile = options.logFile ?? defaultLogPath()
  const state: ServerState = {
    options,
    logFile,
    recent: [],
    judge: options.judgeClient ?? createTypesafeClient(),
    telemetry: telemetryPolicy(options.config.telemetry),
    sessions: new Map(),
    notEntitled: new Map(),
    // Loaded once at startup, not lazily inside a request: a sync read/parse of the whole
    // decision log must never block a live request, and a read failure here (rotated file,
    // permissions) must never be mistaken for a judge outage. Degrades to no tie-breaker, not a
    // crash — the deterministic policy and Jev's existing thresholds still work unchanged.
    recoveryProfile: (() => {
      try {
        return loadRecovery(logFile)
      } catch (error) {
        console.warn(`Sabi: could not load the local recovery profile from ${logFile}: ${(error as Error).message}`)
        return undefined
      }
    })(),
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

  const violation = originViolation(req)
  if (violation) {
    sendError(res, 403, violation)
    return
  }

  if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
    // `text/plain` is a CORS simple request (no preflight): a foreign page could fire it
    // without ever reading the response. Only JSON dispatch is a legitimate local call.
    const contentType = Array.isArray(req.headers['content-type'])
      ? req.headers['content-type'].join(',')
      : req.headers['content-type']
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      sendError(res, 415, 'content-type must be application/json')
      return
    }
    await handleChat(state, req, res)
    return
  }
  // Borrowed-authentication routes: the harness's own wire format, forwarded with the harness's
  // own credential. Same JSON-only dispatch rule as the OpenAI route — `text/plain` is a CORS
  // simple request that a foreign page could fire without ever reading the response.
  if (req.method === 'POST' && (path === '/v1/messages' || path === '/v1/responses')) {
    const contentType = Array.isArray(req.headers['content-type'])
      ? req.headers['content-type'].join(',')
      : req.headers['content-type']
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      sendError(res, 415, 'content-type must be application/json')
      return
    }
    await handlePassthroughRequest(state, req, res, path === '/v1/messages' ? 'anthropic' : 'responses')
    return
  }
  if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
    sendJson(res, 200, { object: 'list', data: modelSummary(state.options.config) })
    return
  }
  if (req.method === 'GET' && path === '/healthz') {
    // Never leak the absolute log path: it is host filesystem layout, not health.
    sendJson(res, 200, {
      ok: true,
      models: Object.keys(state.options.config.aliases),
      upstreams: Object.keys(state.options.config.upstreams),
    })
    return
  }
  if (req.method === 'GET' && path === '/decisions') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, RECENT_LIMIT)
    const decisions = state.recent.slice(-limit)
    sendJson(res, 200, { count: decisions.length, decisions })
    return
  }
  if (req.method === 'GET' && path === '/dashboard') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.writeHead(200)
    // Same baseline as `sabi report`: the strong tier, else the first configured model.
    const { models } = state.options.config
    const lang = url.searchParams.get('lang') === 'pt-BR' ? 'pt-BR' : 'en'
    const hours = DASHBOARD_WINDOWS.find((h) => String(h) === url.searchParams.get('hours')) ?? 48
    // ponytail: re-reads the whole decision log per page load; fine at MBs, tail-read if it grows to GBs.
    let logged: DecisionRecord[] = []
    try {
      logged = readDecisions(state.logFile)
    } catch {
      // An unreadable log (permissions, a directory in its place) degrades to this process's rounds.
    }
    res.end(renderDashboard(logged.length > 0 ? logged : state.recent, {
      baselineRates: (models.strong ?? Object.values(models)[0])?.cost,
      lang,
      hours,
      source: logged.length > 0 ? 'log' : 'memory',
    }))
    return
  }
  sendError(res, 404, `no route for ${req.method} ${path}`, 'not_found')
}

/**
 * One borrowed round. The deadline, the abort wiring and the identity fields are the same as the
 * OpenAI route, so a borrowed round cannot outlive its budget or record a different identity.
 */
async function handlePassthroughRequest(
  state: ServerState,
  req: IncomingMessage,
  res: ServerResponse,
  format: PassthroughFormat,
): Promise<void> {
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
  try {
    await handlePassthrough(
      { config: state.options.config, logFile: state.logFile, recent: state.recent, identity: requestIdentity(req) },
      req,
      res,
      format,
      signal,
    )
  } catch (error) {
    const deadline = signal.aborted && (signal.reason as Error)?.name === 'TimeoutError'
    const aborted = signal.aborted && !deadline
    const status = deadline ? 504 : error instanceof SabiRouteError ? error.status : 502
    const message = deadline ? 'request deadline exceeded' : aborted ? 'client aborted'
      : error instanceof SabiRouteError ? error.message : 'borrowed upstream request failed'
    if (!res.destroyed && !res.writableFinished) {
      if (aborted) {
        res.destroy()
      } else if (res.headersSent) {
        // Already committed as 200, so the failure cannot become a status code: end the stream with
        // an explicit SSE error frame instead of a silent close the client cannot classify.
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', error: { type: 'sabi_error', message } })}\n\n`)
          res.end()
        } catch {
          res.destroy()
        }
      } else {
        sendError(res, status, message)
      }
    }
  } finally {
    clearTimeout(timeout)
    req.off('aborted', disconnected)
    res.off('close', disconnected)
  }
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
  /** Why the planned upstream refused (spec 020); kept outside the try so a failed fallback still records it. */
  let refusal: UpstreamRefusal | undefined
  // Hoisted out of the `try` below: the effort helper is defined next to `saveDecision` — where the
  // other writers of `record` live — and reads this value, so declaring it inside the try would put
  // the definition site in TS2304 territory. It is per round, exactly like `record` and `decision`.
  let judgeRecord: JudgeRecord | undefined
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
    rememberFailure(state, record)
    appendDecision(record, state.logFile)
    // The mirror observes; it never influences. A sink that throws is swallowed here so a
    // mirror outage can never fail or delay a round that already completed.
    if (state.options.shadow) {
      try {
        state.options.shadow.observe(record)
      } catch {
        // Mirror pressure is not routing pressure.
      }
    }
    state.recent.push(record)
    if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT)
    if (state.options.verbose !== false) {
      const cost = record.cost ? ` $${record.cost.total.toFixed(5)}` : ''
      const tokens = record.usage ? ` ${record.usage.promptTokens}in/${record.usage.completionTokens}out` : ''
      console.log(`[sabi] ${record.alias} -> ${record.tier} (${record.rule}) -> ${record.upstreamModel}` +
        ` · ${record.latencyMs}ms${tokens}${cost} · ${record.outcome}`)
    }
  }
  // Spec 021: captured after the judge and the dispatch gate, before any upstream call, because
  // a fallback rewrites `record.tier` and the planned route is otherwise lost.
  let requested: RouteSide | undefined
  const receipt = (servedModel: string | undefined, fallbackTier: string | undefined): RouteReceipt | undefined => {
    if (!requested || !decision) return undefined
    const effective = { tier: decision.tier, model: servedModel ?? decision.upstreamModel, observed: servedModel !== undefined }
    const reason = fallbackTier ? 'fallback' : effective.model !== requested.model ? 'substituted' : undefined
    return { requested, effective, ...(reason ? { reason } : {}) }
  }
  const observeModel = (model: unknown): string | undefined =>
    typeof model === 'string' && Object.values(config.models).some((entry) =>
      entry.upstream === decision?.upstream && entry.model === model) ? model : undefined
  const saveDecision = (next: RouteDecision): void => {
    if (!record) return
    Object.assign(record, {
      alias: next.alias, mode: next.mode, rule: next.rule, tier: next.tier,
      reason: sanitizeReason(next.reason, state.telemetry), upstream: next.upstream, upstreamModel: next.upstreamModel,
      cache: next.cache,
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
  /**
   * The single writer of the six effort fields. Called once after routing (including any judge
   * override) and again on a successful transport fallback, where the final tier — and therefore the
   * ladder the percentage resolves against — has changed. When the final tier resolves no ladder, or
   * the feature is off, the fields are cleared instead of left describing the previous tier.
   *
   * This does not touch the request the upstream receives: `buildUpstreamBody` is unchanged, so the
   * wire's effort field still carries exactly what the client sent.
   */
  const applyEffortSchedule = (target: RouteDecision): void => {
    if (!record) return
    const schedule = scheduleEffort(config, target, judgeRecord)
    if (schedule) {
      record.effortPercent = schedule.percent
      record.effortPlanned = schedule.planned
      record.effortIndex = schedule.index
      record.effortLevel = schedule.level
      record.effortLadder = schedule.ladder
      record.effortReason = schedule.reason
      return
    }
    delete record.effortPercent
    delete record.effortPlanned
    delete record.effortIndex
    delete record.effortLevel
    delete record.effortLadder
    delete record.effortReason
  }

  try {
    const identity = requestIdentity(req)
    res.setHeader('x-sabi-request-id', identity.requestId!)
    const raw = await readRequestBody(req, signal)
    let parsed: unknown
    try { parsed = JSON.parse(raw.toString('utf8')) } catch { throw new SabiRouteError('invalid request body') }
    if (!isObject(parsed) || !Array.isArray(parsed.messages) || !parsed.messages.length ||
      parsed.messages.some((message) => !isObject(message) || typeof message.role !== 'string')) {
      throw new SabiRouteError('invalid request body')
    }
    const body = parsed as ChatRequestBody
    stage = 'route'
    decision = route(body, config, observeSession(state, identity, body))
    const effort = observeEffort(body)
    record = {
      ts: new Date().toISOString(), ...identity,
      alias: decision.alias, mode: decision.mode, rule: decision.rule, tier: decision.tier,
      reason: '', upstream: decision.upstream, upstreamModel: decision.upstreamModel,
      ...(effort.value !== undefined ? { effort: effort.value } : {}),
      effortSource: effort.source,
      stream: body.stream === true, state: decision.state, outcome: 'ok',
    }
    saveDecision(decision)

    // Judge is a separate, bounded execution-evaluation lane. Cache affinity owns the
    // conversation route; a retained same-cycle model must not be replaced by the evaluator.
    stage = 'judge'
    if (decision.mode === 'auto' && decision.cache?.action !== 'keep' && config.judge && judgeTriggers(decision, config.judge)) {
      // The judge endpoint is an explicit egress surface: raw instruction/tool text leaves
      // only on operator opt-in (`judge.includeSnippets` or `telemetry.captureSnippets`).
      const judgeState = buildJudgeState(body, decision, config.judge.maxStateChars, {
        captureSnippets: config.telemetry?.captureSnippets,
        includeSnippets: config.judge?.includeSnippets,
      })
      const judgeStarted = Date.now()
      try {
        const result = await abortable(state.judge.ask(judgeState, JUDGE_QUESTIONS, config.judge, signal), signal)
        const applied = applyJudge(decision, config, result.outcome, state.recoveryProfile)
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
    applyEffortSchedule(decision)
    stage = 'route'
    // Jev may change the selected tier. It must not bypass the shared compatibility gate.
    // Dispatch, not planning: by the time a request reaches the server a
    // route has been chosen, and a client max_tokens ceiling must not throw
    // away a route that can serve a shorter answer.
    ensureRouteCompatible(body, config, decision, { allowOutputClamp: true })
    signal.throwIfAborted()
    stage = 'upstream'
    // Transport failures on an adaptive round may retry on the next serving
    // tier when the operator opts in with `transportFallback.enabled` (default
    // off). Fixed aliases never fall back: an explicit choice that fails is
    // served as-is. A fallback that also fails is consumed quietly and the
    // planned tier's original error is served, so the client never sees a
    // confusing mix.
    //
    // 401 belongs here and did not. A dead credential is the most recoverable
    // fault there is — every OTHER provider's key is usually fine — and
    // treating it as terminal meant one expired OpenRouter key stranded a
    // machine that had six working tiers behind it.
    // A harness that routes one of its own providers through Sabi sends its
    // own credential with the request. That token is honoured on every
    // attempt, plan and fallback alike, so a working borrowed credential is
    // not discarded in favour of an expired configured one.
    // Opt-in, and off by default: without this a client could choose which
    // credential Sabi spends, or talk it into presenting a token to a
    // provider it did not intend.
    const rawAuthorization = config.borrowedCredentials === true ? req.headers.authorization : undefined
    const callerToken = borrowedCredential(Array.isArray(rawAuthorization) ? rawAuthorization[0] : rawAuthorization)
    const fallbackEnabled = decision.mode === 'auto' && config.transportFallback?.enabled === true
    requested = { tier: decision.tier, model: decision.upstreamModel, ...(record.effort !== undefined ? { effort: record.effort } : {}) }
    // Spec 020. Two refusals are known before any call. A key variable that never resolved
    // is a configuration error, not an outage: nothing is sent, and the round may move only
    // to a free tier, never buy a paid one to cover a missing key. A model this account's
    // plan refused within the TTL is routed around rather than asked again. A borrowed
    // credential is another account, so neither applies to it.
    const known = knownRefusal(state, decision.upstream, decision.upstreamModel, callerToken)
    // With nowhere to route, a remembered plan refusal is asked again rather than failed locally.
    const skipPlanned = known === 'unconfigured' || (known === 'not-entitled' && fallbackEnabled)
    const missingKey = known === 'unconfigured' ? unresolvedKeyReference(config.upstreams[decision.upstream]) : undefined
    if (skipPlanned && known) refusal = { class: known, upstream: decision.upstream }
    const refusalMessage = missingKey !== undefined
      ? `upstream '${decision.upstream}' is not configured: $${missingKey} is not set`
      : `upstream '${decision.upstream}' does not include this model in its plan`
    // The failed body is read once, here: classifying a refusal needs it, and serving it later
    // must not find a stream the fallback walk already cancelled.
    let firstFailureText = skipPlanned
      ? JSON.stringify({ error: { message: refusalMessage, type: 'sabi_error', code: missingKey !== undefined ? 502 : 403 } })
      : undefined
    let upstreamResponse = skipPlanned
      ? new Response(firstFailureText, { status: missingKey !== undefined ? 502 : 403, headers: { 'content-type': 'application/json; charset=utf-8' } })
      : (await callUpstream(config, decision, buildUpstreamBody(config, decision, body), signal, callerToken)).response
    if (!skipPlanned && !upstreamResponse.ok) {
      const { status } = upstreamResponse
      if (status === 402 || status === 403) {
        firstFailureText = await readErrorHead(upstreamResponse).catch((error) => {
          if (signal.aborted) throw error
          return ''
        })
      }
      const keySent = callerToken !== undefined || resolveKey(config.upstreams[decision.upstream]?.apiKey) !== undefined
      refusal = { class: refusalClass(status, firstFailureText ?? '', platformRateLimited(upstreamResponse), keySent), upstream: decision.upstream, status }
      rememberRefusal(state, refusal.class, decision.upstream, decision.upstreamModel, callerToken)
    }
    let fallbackTier: string | undefined
    // The error a client is shown must be the error that actually ended the
    // round. When a fallback fails, `upstreamResponse` still holds the FIRST
    // failure -- typically a dead credential on the planned tier -- so a
    // transient upstream error on the last route in the chain surfaced as
    // "401 API key expired" and sent the operator hunting a key that was never
    // the problem. Keep the last real failure and serve that instead.
    let lastFallbackFailure: { status: number; text: string; tier: string } | undefined
    if (refusal && fallbackEnabled && (skipPlanned ||
      upstreamResponse.status === 401 ||
      upstreamResponse.status === 429 ||
      upstreamResponse.status === 402 ||
      upstreamResponse.status === 403)) {
      const required = decision.state.inputModalities ?? []
      // A 429 is a statement about the POOL only when the platform itself
      // enforced it. OpenRouter documents that its own limits (including the
      // shared free-model caps) carry X-RateLimit-* headers; a 429 passed
      // through from one model's provider does not, and says nothing about
      // the other free models. Treating both as pool-wide skipped every
      // healthy :free model after one busy one, and served the 429 instead.
      const quotaRefusal = refusal.class === 'quota'
      // A 401 is a statement about the UPSTREAM, and a wider one: every tier
      // behind the same credential is equally dead, so the chain must leave
      // the provider rather than try its next model. Walking to another
      // model on the same dead key is how a single expired secret becomes
      // four identical failures.
      const credentialFailure = upstreamResponse.status === 401 || refusal.class === 'unconfigured'
      // Release the failed response before walking the chain. Leaving its body
      // unread holds the connection open while the next attempt runs, and the
      // retry then fails for a reason that has nothing to do with the retry.
      await upstreamResponse.body?.cancel().catch(() => {})
      const fallbackChain = getFallbackChain(config, decision.tier, required, quotaRefusal)
        .filter((f) => !(credentialFailure && f.upstream === decision!.upstream))
        .filter((f) => refusal!.class !== 'unconfigured' || isFreeModel(config.models[f.tier]))
      // A platform limit met mid-chain speaks for its whole pool too: skip the rest
      // of that pool instead of spending one guaranteed-to-fail call per member.
      const exhaustedPools = new Set<string>()
      for (const fallback of fallbackChain) {
        const pool = quotaPoolOf(config.models[fallback.tier]!)
        if (pool !== 'none' && exhaustedPools.has(pool)) continue
        // Known refusals cost nothing to skip and one wasted call each to rediscover.
        if (knownRefusal(state, fallback.upstream, fallback.upstreamModel, callerToken)) continue
        const attempt: RouteDecision = {
          ...decision,
          tier: fallback.tier,
          rule: 'transport-fallback',
          reason: fallback.reason,
          model: fallback.tier,
          upstream: fallback.upstream,
          upstreamModel: fallback.upstreamModel,
        }
        try {
          // Same reasoning as the dispatch gate above, and the reason a
          // large client ceiling could empty the whole chain and serve the
          // original error with every working route untried behind it.
          ensureRouteCompatible(body, config, attempt, { allowOutputClamp: true })
        } catch {
          continue
        }
        const { response: retry } = await callUpstream(config, attempt, buildUpstreamBody(config, attempt, body), signal, callerToken)
        if (retry.ok) {
          decision = attempt
          fallbackTier = attempt.tier
          saveDecision(decision)
          applyEffortSchedule(decision)
          upstreamResponse = retry
          break
        }
        if (pool !== 'none' && platformRateLimited(retry)) exhaustedPools.add(pool)
        lastFallbackFailure = { status: retry.status, text: await readErrorText(retry).catch(() => ''), tier: attempt.tier }
        rememberRefusal(state, refusalClass(retry.status, lastFallbackFailure.text, false, true), attempt.upstream, attempt.upstreamModel, callerToken)
        // Keep walking. This used to break on anything that was not
        // 429/402/403, so a single overloaded provider (503) ended the chain
        // and the original error was served -- the routes behind it, which
        // were perfectly reachable, never ran. The chain is a list of
        // distinct routes; one of them being down is not evidence about the
        // next. Same-upstream candidates are already excluded on a credential
        // failure, so there is no dead key to re-walk here.
      }
    }

    if (!upstreamResponse.ok) {
      // A missing key is the root cause however the chain ended; a free tier's 503 behind it
      // must not hide the variable the operator has to set.
      const served = refusal?.class === 'unconfigured' ? undefined : lastFallbackFailure
      const text = served
        ? (served.text || `upstream error ${served.status}`)
        : firstFailureText ?? await readErrorText(upstreamResponse)
      const status = served?.status ?? upstreamResponse.status
      const headers: Record<string, string> = { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8' }
      const retryAfter = upstreamResponse.headers.get('retry-after')
      if (retryAfter !== null) headers['retry-after'] = retryAfter
      res.writeHead(status, headers)
      res.end(text || JSON.stringify({ error: { message: `upstream error ${status}` } }))
      await responseFinished()
      // No provider answered this round: the record must not read as an upstream status.
      const refusedLocally = refusal?.status === undefined && (refusal?.class === 'unconfigured' || !lastFallbackFailure)
      finish(refusal && refusedLocally
        ? { outcome: 'error', error: refusalMessage, upstreamRefusal: refusal }
        : { outcome: status === 429 || status >= 500 ? 'transport' : 'error',
          error: `upstream HTTP ${status}`, transport: status, ...(refusal ? { upstreamRefusal: refusal } : {}) })
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
      finish({ usage: usageFromJson(object), servedModel, ...(fallbackTier ? { fallback: fallbackTier } : {}),
        ...(refusal ? { upstreamRefusal: refusal } : {}), route: receipt(servedModel, fallbackTier) })
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
      const servedModel = observeModel(streamResult?.model)
      finish({ usage: streamResult?.usage, servedModel, ttftMs, ...(fallbackTier ? { fallback: fallbackTier } : {}),
        ...(refusal ? { upstreamRefusal: refusal } : {}), route: receipt(servedModel, fallbackTier) })
  } catch (error) {
    const deadline = signal.aborted && (signal.reason as Error)?.name === 'TimeoutError'
    const aborted = signal.aborted && !deadline
    const status = deadline ? 504 : error instanceof SabiRouteError ? error.status : stage === 'upstream' ? 502 : 500
    const message = deadline ? 'request deadline exceeded' : aborted ? 'client aborted' :
      error instanceof SabiRouteError ? error.message : stage === 'upstream' ? 'invalid or failed upstream response' : 'sabi internal error'
    if (!res.destroyed && !res.writableFinished) {
      if (aborted) {
        res.destroy()
      } else if (res.headersSent) {
        // The status line is already committed (HTTP 200), so no failure can become a status code —
        // including a deadline. A destroyed socket leaves the client with "socket connection was
        // closed unexpectedly" and no error object; that text then reads as a task failure on the
        // next round and escalates to the tier that just timed out. The explicit SSE error frame is
        // what lets a client classify a transport timeout as transport, so it is written here too.
        try {
          const frameMessage = error instanceof UpstreamStreamError
            ? sanitizeError(error.providerMessage)
            : message
          res.write(`data: ${JSON.stringify({ error: { message: frameMessage, type: 'sabi_error', code: status } })}\n\n`)
          res.end()
        } catch {
          res.destroy()
        }
      } else {
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
      ...(refusal ? { upstreamRefusal: refusal } : {}),
    })
    if (!signal.aborted) controller.abort()
  } finally {
    clearTimeout(timeout)
    req.off('aborted', disconnected)
    res.off('close', disconnected)
  }
}
