import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveKey, type JudgeConfig, type JudgeOutcome, type JudgeQuestions } from '@sabi/core'

export interface JudgeCallResult {
  outcome: JudgeOutcome
  cached: boolean
  latencyMs: number
}

export interface JudgeClient {
  ask(state: unknown, questions: JudgeQuestions, config: JudgeConfig, signal?: AbortSignal): Promise<JudgeCallResult>
}

interface CacheEntry {
  expires: number
  outcome: JudgeOutcome
}

export interface TypesafeClientOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  maxCacheEntries?: number
}

const RETRYABLE = new Set([429, 529])

export function validateAnswers(payload: unknown, questions: JudgeQuestions, requestedModel: string): JudgeOutcome {
  if (!payload || typeof payload !== 'object') throw new Error('typesafe: empty response')
  const record = payload as Record<string, unknown>
  const answers = record.answers
  if (!answers || typeof answers !== 'object') throw new Error('typesafe: missing answers map')
  const map = answers as Record<string, unknown>

  const outcome: JudgeOutcome = {
    model: typeof record.model === 'string' && record.model ? record.model : requestedModel,
  }

  // Only validate questions that were actually sent.
  const has = (key: keyof JudgeQuestions): boolean => key in questions

  if (has('real_problem')) {
    const real = map.real_problem as Record<string, unknown> | undefined
    if (!real || real.type !== 'noul') throw new Error('typesafe: missing noul answer for real_problem')
    const noul = Number(real.noul)
    if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
      throw new Error('typesafe: real_problem.noul out of range')
    }
    outcome.realProblem = noul
  }

  if (has('difficulty')) {
    const difficulty = map.difficulty as Record<string, unknown> | undefined
    if (!difficulty || difficulty.type !== 'choice') throw new Error('typesafe: missing choice answer for difficulty')
    const options = Object.keys(questions.difficulty.criteria)
    const choice = String(difficulty.choice ?? '')
    if (!options.includes(choice)) throw new Error(`typesafe: unknown difficulty choice '${choice}'`)
    const confidence = Number(difficulty.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('typesafe: difficulty.confidence out of range')
    }
    const probabilities = (difficulty.probabilities ?? {}) as Record<string, unknown>
    for (const option of options) {
      const probability = Number(probabilities[option])
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error(`typesafe: difficulty probability missing for '${option}'`)
      }
    }
    outcome.difficulty = choice
    outcome.difficultyConfidence = confidence
  }

  // The evidence-redundancy question is shadow-only: it measures what a future context-selection
  // step could drop. A missing or malformed shadow answer must never fail the applied judgment,
  // so it is read leniently — absence stays absence, never an error.
  if (has('evidence_redundant')) {
    const shadow = map.evidence_redundant as Record<string, unknown> | undefined
    if (shadow && shadow.type === 'noul') {
      const value = Number(shadow.noul)
      if (Number.isFinite(value) && value >= 0 && value <= 1) outcome.evidenceRedundant = value
    }
  }

  if (has('routing')) {
    const routing = map.routing as Record<string, unknown> | undefined
    if (!routing || routing.type !== 'choice') throw new Error('typesafe: missing choice answer for routing')
    const options = Object.keys(questions.routing.criteria)
    const choice = String(routing.choice ?? '')
    if (!options.includes(choice)) throw new Error(`typesafe: unknown routing choice '${choice}'`)
    const confidence = Number(routing.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('typesafe: routing.confidence out of range')
    }
    outcome.routingTier = choice
    outcome.routingConfidence = confidence
  }

  const usage = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? record.usage as Record<string, unknown> : undefined
  const inputTokens = usage?.input_tokens
  const outputTokens = usage?.output_tokens
  const validTokens = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (validTokens(inputTokens) && validTokens(outputTokens)) {
    outcome.usage = { inputTokens, outputTokens }
  }

  return outcome
}

async function callJev(
  fetchImpl: typeof fetch,
  config: JudgeConfig,
  model: string,
  state: unknown,
  questions: JudgeQuestions,
  signal?: AbortSignal,
): Promise<JudgeOutcome> {
  const url = `${config.baseURL.replace(/\/+$/, '')}/systemone`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = resolveKey(config.apiKey)
  if (key) headers.authorization = `Bearer ${key}`
  const body = JSON.stringify({ state, model, questions })
  const timeoutMs = config.timeoutMs ?? 2500
  const timeout = AbortSignal.timeout(timeoutMs)
  const callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

  for (let attempt = 1; ; attempt += 1) {
    callSignal.throwIfAborted()
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers, body, signal: callSignal })
    if ((RETRYABLE.has(response.status) || response.status >= 500) && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 0)
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : 400
      await response.body?.cancel()
      await delay(waitMs, undefined, { signal: callSignal })
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`typesafe ${response.status}`)
    }
    const payload = (await response.json()) as unknown
    return validateAnswers(payload, questions, model)
  }
}

export function createTypesafeClient(options: TypesafeClientOptions = {}): JudgeClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => Date.now())
  const maxEntries = options.maxCacheEntries ?? 256
  const cache = new Map<string, CacheEntry>()

  return {
    async ask(state, questions, config, signal) {
      signal?.throwIfAborted()
      const model = config.model ?? 'jev-latest'
      const cacheKey = createHash('sha256')
        .update(JSON.stringify({ model, state, questions }))
        .digest('hex')
      const ttl = config.cacheTtlMs ?? 600_000
      const hit = cache.get(cacheKey)
      if (hit && hit.expires > now()) {
        return { outcome: hit.outcome, cached: true, latencyMs: 0 }
      }
      const started = now()
      const outcome = await callJev(fetchImpl, config, model, state, questions, signal)
      const latencyMs = now() - started
      if (ttl > 0) {
        cache.set(cacheKey, { expires: now() + ttl, outcome })
        while (cache.size > maxEntries) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
      }
      return { outcome, cached: false, latencyMs }
    },
  }
}
