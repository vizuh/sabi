import test from 'node:test'
import assert from 'node:assert/strict'
import { JUDGE_QUESTIONS, type JudgeConfig, type JudgeQuestions } from '@sabi/core'
import { createTypesafeClient, validateAnswers } from '../src/typesafe.ts'

const config: JudgeConfig = {
  enabled: true,
  baseURL: 'https://api.typesafe.ai/v1',
  model: 'jev-latest',
  timeoutMs: 1000,
  cacheTtlMs: 60_000,
}

const goodPayload = {
  model: 'jev-1.13.0',
  answers: {
    real_problem: { type: 'noul', noul: 0.12 },
    difficulty: {
      type: 'choice',
      choice: 'standard',
      probabilities: { trivial: 0.12, standard: 0.79, demanding: 0.09 },
      confidence: 0.82,
    },
    routing: {
      type: 'choice',
      choice: 'mid',
      probabilities: { cheap: 0.15, mid: 0.72, strong: 0.13 },
      confidence: 0.80,
    },
  },
  usage: { input_tokens: 300, output_tokens: 40 },
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

test('valid answers map to a judge outcome', () => {
  const outcome = validateAnswers(goodPayload, JUDGE_QUESTIONS, 'jev-latest')
  assert.equal(outcome.realProblem, 0.12)
  assert.equal(outcome.difficulty, 'standard')
  assert.equal(outcome.difficultyConfidence, 0.82)
  assert.equal(outcome.model, 'jev-1.13.0')
  assert.deepEqual(outcome.usage, { inputTokens: 300, outputTokens: 40 })
  assert.equal(outcome.routingTier, 'mid')
  assert.equal(outcome.routingConfidence, 0.80)
})

test('missing or malformed usage stays unknown instead of becoming free', () => {
  for (const usage of [undefined, {}, { input_tokens: 1 }, { output_tokens: 2 },
    { input_tokens: -1, output_tokens: 2 }, { input_tokens: 1.5, output_tokens: 2 }]) {
    const payload = { ...goodPayload, usage }
    const outcome = validateAnswers(payload, JUDGE_QUESTIONS, 'jev-latest')
    assert.equal(outcome.usage, undefined)
  }
})

test('malformed answers are rejected', () => {
  const badChoice = structuredClone(goodPayload)
  badChoice.answers.difficulty.choice = 'impossible'
  assert.throws(() => validateAnswers(badChoice, JUDGE_QUESTIONS, 'jev-latest'), /unknown difficulty choice/)

  const badProbability = structuredClone(goodPayload)
  badProbability.answers.difficulty.probabilities.trivial = 2
  assert.throws(() => validateAnswers(badProbability, JUDGE_QUESTIONS, 'jev-latest'), /probability/)

  const badNoul = structuredClone(goodPayload)
  badNoul.answers.real_problem.noul = 1.4
  assert.throws(() => validateAnswers(badNoul, JUDGE_QUESTIONS, 'jev-latest'), /noul out of range/)

  assert.throws(() => validateAnswers({}, JUDGE_QUESTIONS, 'jev-latest'), /missing answers/)
})

test('a successful call returns the outcome and caches repeats', async () => {
  let calls = 0
  const client = createTypesafeClient({
    fetchImpl: (async () => {
      calls += 1
      return jsonResponse(goodPayload)
    }) as typeof fetch,
  })
  const first = await client.ask({ a: 1 }, JUDGE_QUESTIONS, config)
  assert.equal(first.cached, false)
  assert.equal(first.outcome.difficulty, 'standard')
  assert.equal(first.outcome.routingTier, 'mid')
  const second = await client.ask({ a: 1 }, JUDGE_QUESTIONS, config)
  assert.equal(second.cached, true)
  assert.equal(calls, 1)
  const third = await client.ask({ a: 2 }, JUDGE_QUESTIONS, config)
  assert.equal(third.cached, false)
  assert.equal(calls, 2)
})

test('rate limits are retried once', async () => {
  let calls = 0
  const client = createTypesafeClient({
    fetchImpl: (async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '0' })
      return jsonResponse(goodPayload)
    }) as typeof fetch,
  })
  const result = await client.ask({ b: 1 }, JUDGE_QUESTIONS, config)
  assert.equal(result.outcome.difficulty, 'standard')
  assert.equal(result.outcome.routingTier, 'mid')
  assert.equal(calls, 2)
})

test('api errors propagate to the caller', async () => {
  const client = createTypesafeClient({
    fetchImpl: (async () => jsonResponse({ error: 'nope' }, 401)) as typeof fetch,
  })
  await assert.rejects(() => client.ask({ c: 1 }, JUDGE_QUESTIONS, config), /typesafe 401/)
})

test('the client sends the documented request shape', async () => {
  let seen: { url: string; init?: RequestInit } | undefined
  const client = createTypesafeClient({
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init }
      return jsonResponse(goodPayload)
    }) as typeof fetch,
  })
  await client.ask({ round: 1 }, JUDGE_QUESTIONS, config)
  assert.equal(seen?.url, 'https://api.typesafe.ai/v1/systemone')
  const body = JSON.parse(String(seen?.init?.body)) as { model: string; questions: unknown; state: unknown }
  assert.equal(body.model, 'jev-latest')
  assert.deepEqual(body.state, { round: 1 })
  assert.deepEqual(Object.keys(body.questions as object).sort(), ['difficulty', 'evidence_redundant', 'real_problem', 'routing'])
  assert.equal((seen?.init?.headers as Record<string, string>)['content-type'], 'application/json')
})

test('the shadow evidence answer is read leniently and never fails the applied judgment', () => {
  const withShadow = structuredClone(goodPayload)
  ;(withShadow.answers as Record<string, unknown>).evidence_redundant = { type: 'noul', noul: 0.81 }
  assert.equal(validateAnswers(withShadow, JUDGE_QUESTIONS, 'jev-latest').evidenceRedundant, 0.81)

  // Missing entirely: the applied answers still validate and the shadow field stays absent.
  assert.equal(validateAnswers(goodPayload, JUDGE_QUESTIONS, 'jev-latest').evidenceRedundant, undefined)

  // Malformed or out of range: still no throw — a shadow question must not take the judge down.
  const outOfRange = structuredClone(goodPayload)
  ;(outOfRange.answers as Record<string, unknown>).evidence_redundant = { type: 'noul', noul: 2 }
  assert.equal(validateAnswers(outOfRange, JUDGE_QUESTIONS, 'jev-latest').evidenceRedundant, undefined)
  const wrongType = structuredClone(goodPayload)
  ;(wrongType.answers as Record<string, unknown>).evidence_redundant = { type: 'choice', choice: 'x' }
  assert.equal(validateAnswers(wrongType, JUDGE_QUESTIONS, 'jev-latest').evidenceRedundant, undefined)
  // Routing is read leniently when absent: a missing routing answer in a non-routing call must not fail.
  const noRoutingQuestions = {
    real_problem: JUDGE_QUESTIONS.real_problem,
    difficulty: JUDGE_QUESTIONS.difficulty,
    evidence_redundant: JUDGE_QUESTIONS.evidence_redundant,
  } satisfies Omit<JudgeQuestions, 'routing'>
  assert.equal(validateAnswers(goodPayload, noRoutingQuestions as JudgeQuestions, 'jev-latest').routingTier, undefined)
  // Malformed routing choice is rejected.
  const badRouting = structuredClone(goodPayload)
  ;(badRouting.answers as Record<string, unknown>).routing = { type: 'choice', choice: 'impossible' }
  assert.throws(() => validateAnswers(badRouting, JUDGE_QUESTIONS, 'jev-latest'), /unknown routing choice/)
})
