import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord } from '@sabi/core'
import { createSabiServer } from '../src/server.ts'

// Specs 020 and 021. Model ids are synthetic fixtures, not live provider claims.
const UNSET = 'SABI_TEST_UNSET_KEY_155'
const SET = 'SABI_TEST_SET_KEY_155'

let mock: Server
let port = 0
let calls: Array<{ model: string; auth: boolean }> = []
/** Per-model scripted failure; anything absent answers 200. */
let failures: Record<string, { status: number; message: string; stall?: boolean }> = {}

before(async () => {
  delete process.env[UNSET]
  process.env[SET] = 'fixture-not-a-secret'
  mock = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const model = String((JSON.parse(raw) as { model?: unknown }).model)
      calls.push({ model, auth: req.headers.authorization !== undefined })
      const failure = failures[model]
      if (failure?.stall) {
        // Headers and a partial body, then nothing: a provider that stalled mid-error.
        res.writeHead(failure.status, { 'content-type': 'application/json' })
        res.write('{"error":{"message":"')
        return
      }
      if (model === 'garbage-ok') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('not json')
        return
      }
      if (failure) {
        res.writeHead(failure.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: failure.message } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'c1', object: 'chat.completion', model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }))
    })
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => {
    port = (mock.address() as { port: number }).port
    resolve()
  }))
})

after(() => {
  mock.close()
  delete process.env[SET]
})

type Models = Record<string, { upstream: string; model: string; cost: { input: number; output: number } }>

async function round(
  upstreams: Record<string, { apiKey?: string | false }>,
  models: Models,
  options: { fallback?: boolean; alias?: string; rounds?: number; requestTimeoutMs?: number } = {},
): Promise<{ status: number; text: string; records: DecisionRecord[] }> {
  const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'sabi-refusal-')), 'd.jsonl')
  const config = validateConfig({
    upstreams: Object.fromEntries(Object.entries(upstreams).map(([name, entry]) =>
      [name, { baseURL: `http://127.0.0.1:${port}/v1`, ...entry }])),
    models,
    aliases: { 'sabi-code': 'auto', 'sabi-fixed': 'cheap' },
    policy: { unclassified: 'cheap' },
    transportFallback: { enabled: options.fallback !== false },
    judge: { enabled: false },
  })
  const sabi = createSabiServer({ config, logFile, verbose: false, ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}) })
  const listening = await sabi.listen(0, '127.0.0.1')
  let status = 0
  let text = ''
  try {
    for (let i = 0; i < (options.rounds ?? 1); i += 1) {
      const response = await fetch(`http://127.0.0.1:${listening}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.alias ?? 'sabi-code', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
      })
      status = response.status
      text = await response.text()
    }
  } finally {
    await sabi.close()
  }
  const records = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as DecisionRecord)
  return { status, text, records }
}

const free = { input: 0, output: 0 }
const paid = { input: 5, output: 25 }

test('#155: a key variable that never resolved does not buy the paid tier', async () => {
  calls = []
  failures = {}
  const { status, text, records } = await round(
    { freeup: { apiKey: `$${UNSET}` }, paidup: { apiKey: false } },
    { cheap: { upstream: 'freeup', model: 'free-a', cost: free }, strong: { upstream: 'paidup', model: 'paid-a', cost: paid } },
  )
  assert.equal(status, 502)
  assert.match(text, new RegExp(`\\$${UNSET} is not set`))
  assert.deepEqual(calls, [], 'no upstream is called: not the unconfigured one, not the paid one')
  assert.deepEqual(records[0]!.upstreamRefusal, { class: 'unconfigured', upstream: 'freeup' })
  assert.equal(records[0]!.outcome, 'error')
  assert.equal(records[0]!.route, undefined)
})

test('an unconfigured upstream may still fall back to a free tier, with a receipt', async () => {
  calls = []
  failures = {}
  const { status, records } = await round(
    { freeup: { apiKey: `$${UNSET}` }, otherfree: { apiKey: false }, paidup: { apiKey: false } },
    {
      cheap: { upstream: 'freeup', model: 'free-a', cost: free },
      alt: { upstream: 'otherfree', model: 'free-b', cost: free },
      strong: { upstream: 'paidup', model: 'paid-a', cost: paid },
    },
  )
  assert.equal(status, 200)
  assert.deepEqual(calls.map((call) => call.model), ['free-b'])
  assert.deepEqual(records[0]!.route, {
    requested: { tier: 'cheap', model: 'free-a' },
    effective: { tier: 'alt', model: 'free-b', observed: true },
    reason: 'fallback',
  })
})

test('the missing key is served even when the free fallback also fails', async () => {
  calls = []
  failures = { 'free-b': { status: 503, message: 'overloaded' } }
  const { status, text } = await round(
    { freeup: { apiKey: `$${UNSET}` }, otherfree: { apiKey: false } },
    { cheap: { upstream: 'freeup', model: 'free-a', cost: free }, alt: { upstream: 'otherfree', model: 'free-b', cost: free } },
  )
  assert.equal(status, 502)
  assert.match(text, new RegExp(UNSET))
})

test('a fixed alias on an unconfigured upstream fails without a call', async () => {
  calls = []
  failures = {}
  const { status, records } = await round(
    { freeup: { apiKey: `$${UNSET}` } },
    { cheap: { upstream: 'freeup', model: 'free-a', cost: free } },
    { alias: 'sabi-fixed', fallback: false },
  )
  assert.equal(status, 502)
  assert.deepEqual(calls, [])
  assert.equal(records[0]!.upstreamRefusal?.class, 'unconfigured')
})

test('an omitted apiKey is still a keyless upstream, called without auth', async () => {
  calls = []
  failures = {}
  const { status, records } = await round({ local: {} }, { cheap: { upstream: 'local', model: 'free-a', cost: free } })
  assert.equal(status, 200)
  assert.deepEqual(calls, [{ model: 'free-a', auth: false }])
  assert.equal(records[0]!.upstreamRefusal, undefined)
  assert.deepEqual(records[0]!.route, {
    requested: { tier: 'cheap', model: 'free-a' },
    effective: { tier: 'cheap', model: 'free-a', observed: true },
  })
})

test('a 401 from a resolved key is a credential refusal and keeps today\'s fallback', async () => {
  calls = []
  failures = { 'free-a': { status: 401, message: 'key revoked' } }
  const { status, records } = await round(
    { freeup: { apiKey: `$${SET}` }, paidup: { apiKey: false } },
    { cheap: { upstream: 'freeup', model: 'free-a', cost: free }, strong: { upstream: 'paidup', model: 'paid-a', cost: paid } },
  )
  assert.equal(status, 200)
  assert.deepEqual(calls.map((call) => call.model), ['free-a', 'paid-a'])
  assert.deepEqual(records[0]!.upstreamRefusal, { class: 'credential', upstream: 'freeup', status: 401 })
  assert.equal(records[0]!.route?.requested.tier, 'cheap')
  assert.equal(records[0]!.route?.effective.tier, 'strong')
})

test('#156: a model outside the plan is asked once, then routed around', async () => {
  calls = []
  failures = { 'plan-a': { status: 403, message: 'model is not available in the current token plan' } }
  const { status, records } = await round(
    { planup: { apiKey: `$${SET}` }, other: { apiKey: false } },
    { cheap: { upstream: 'planup', model: 'plan-a', cost: free }, alt: { upstream: 'other', model: 'free-b', cost: free } },
    { rounds: 2 },
  )
  assert.equal(status, 200)
  assert.deepEqual(calls.map((call) => call.model), ['plan-a', 'free-b', 'free-b'])
  assert.deepEqual(records[0]!.upstreamRefusal, { class: 'not-entitled', upstream: 'planup', status: 403 })
  assert.deepEqual(records[1]!.upstreamRefusal, { class: 'not-entitled', upstream: 'planup' })
  assert.equal(records[1]!.route?.reason, 'fallback')
})

test('an unknown 403 or a bare 402 is not latched', async () => {
  for (const failure of [
    { status: 403, message: 'forbidden' },
    { status: 402, message: 'insufficient credits' },
    // Feature-level wording is not the cited model-level refusal.
    { status: 403, message: 'Image input is not available in the current plan' },
  ]) {
    calls = []
    failures = { 'plan-a': failure }
    const { records } = await round(
      { planup: { apiKey: `$${SET}` }, other: { apiKey: false } },
      { cheap: { upstream: 'planup', model: 'plan-a', cost: free }, alt: { upstream: 'other', model: 'free-b', cost: free } },
      { rounds: 2 },
    )
    assert.deepEqual(calls.map((call) => call.model), ['plan-a', 'free-b', 'plan-a', 'free-b'])
    assert.equal(records[0]!.upstreamRefusal?.class, 'transient')
  }
})

test('a planned 403 whose body stalls still falls back, well inside the deadline', async () => {
  calls = []
  failures = { 'plan-a': { status: 403, message: '', stall: true } }
  const { status, records } = await round(
    { planup: { apiKey: `$${SET}` }, other: { apiKey: false } },
    { cheap: { upstream: 'planup', model: 'plan-a', cost: free }, alt: { upstream: 'other', model: 'free-b', cost: free } },
    { requestTimeoutMs: 1500 },
  )
  assert.equal(status, 200)
  assert.equal(records[0]!.upstreamRefusal?.class, 'transient')
})

test('a round no provider answered is not logged as an upstream status', async () => {
  calls = []
  const refusal = { status: 403, message: 'model is not available in the current token plan' }
  failures = { 'plan-a': refusal, 'plan-b': refusal }
  const { status, records } = await round(
    { a: { apiKey: `$${SET}` }, b: { apiKey: `$${SET}` } },
    { cheap: { upstream: 'a', model: 'plan-a', cost: free }, alt: { upstream: 'b', model: 'plan-b', cost: free } },
    { rounds: 2 },
  )
  assert.equal(status, 403)
  assert.deepEqual(calls.map((call) => call.model), ['plan-a', 'plan-b'], 'round 2 makes no call')
  assert.equal(records[1]!.transport, undefined)
  assert.match(records[1]!.error ?? '', /does not include this model/)
})

test('a 401 from a keyless upstream is not a rejected key', async () => {
  calls = []
  failures = { 'free-a': { status: 401, message: 'auth required' } }
  const { records } = await round({ local: { apiKey: false } }, { cheap: { upstream: 'local', model: 'free-a', cost: free } })
  assert.equal(records[0]!.upstreamRefusal?.class, 'transient')
})

test('the planned refusal survives a fallback that fails after answering', async () => {
  calls = []
  failures = { 'free-a': { status: 401, message: 'key revoked' } }
  const { records } = await round(
    { freeup: { apiKey: `$${SET}` }, other: { apiKey: false } },
    { cheap: { upstream: 'freeup', model: 'free-a', cost: free }, alt: { upstream: 'other', model: 'garbage-ok', cost: free } },
  )
  assert.equal(records[0]!.outcome, 'error')
  assert.equal(records[0]!.upstreamRefusal?.class, 'credential')
})
