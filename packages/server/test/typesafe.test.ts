import test from 'node:test'
import assert from 'node:assert/strict'
import { JUDGE_QUESTIONS, type JudgeConfig } from '@sabi/core'
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
  assert.deepEqual(Object.keys(body.questions as object).sort(), ['difficulty', 'real_problem'])
  assert.equal((seen?.init?.headers as Record<string, string>)['content-type'], 'application/json')
})
