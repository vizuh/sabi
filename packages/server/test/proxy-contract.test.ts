import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { validateConfig, type SabiConfig } from '@sabi/core'
import { createSabiServer, type SabiServerOptions } from '../src/server.ts'

interface Seen { body: Record<string, unknown>; headers: IncomingHttpHeaders }
type Responder = (seen: Seen, res: ServerResponse) => void | Promise<void>

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolve(typeof address === 'object' && address ? address.port : 0)
  }))
}

function reply(res: ServerResponse, model: unknown = 'mock-cheap', extra: Record<string, unknown> = {}) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ model, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2 }, ...extra }))
}

async function fixture(t: TestContext, respond: Responder = (_seen, res) => reply(res), options: Partial<SabiServerOptions> = {}, mutate?: (config: SabiConfig) => void) {
  const seen: Seen[] = []
  const mock = createServer((req, res) => {
    let raw = ''
    req.on('data', (data) => { raw += data })
    req.on('end', () => {
      const item = { body: JSON.parse(raw) as Record<string, unknown>, headers: req.headers }
      seen.push(item)
      Promise.resolve(respond(item, res)).catch(() => res.destroy())
    })
  })
  const port = await listen(mock)
  const config = validateConfig({
    upstreams: { mock: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: false, streamUsage: true,
      headers: { 'X-Sabi-Session': 'must-not-forward', 'X-Sabi-Permission': 'allow-all' } } },
    models: { cheap: { upstream: 'mock', model: 'mock-cheap' }, mid: { upstream: 'mock', model: 'mock-mid' },
      strong: { upstream: 'mock', model: 'mock-strong' } },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap' },
    policy: { failure: 'strong', 'first-turn': 'cheap', unclassified: 'cheap', exploration: 'cheap', verification: 'mid', implementation: 'mid' },
  })
  mutate?.(config)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-contract-'))
  const logFile = path.join(dir, 'decisions.jsonl')
  const sabi = createSabiServer({ config, logFile, verbose: false, ...options })
  const sabiPort = await sabi.listen(0, '127.0.0.1')
  t.after(async () => {
    sabi.server.closeAllConnections()
    mock.closeAllConnections()
    await Promise.all([sabi.close(), new Promise<void>((resolve) => mock.close(() => resolve()))])
    rmSync(dir, { recursive: true, force: true })
  })
  const url = `http://127.0.0.1:${sabiPort}/v1/chat/completions`
  const post = (body: Record<string, unknown> = {}, headers: Record<string, string> = {}, signal?: AbortSignal) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers)) },
      body: JSON.stringify({ model: 'sabi-code', messages: [{ role: 'user', content: 'identical shared prompt' }], ...body }), signal })
  return { sabi, seen, post, url, logFile }
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return
    await delay(10)
  }
  assert.fail('local proxy event did not settle')
}

test('concurrent identical prompts without IDs remain ungrouped and get server UUIDs', async (t) => {
  const { post, sabi, seen } = await fixture(t)
  const replies = await Promise.all(Array.from({ length: 4 }, () => post()))
  await Promise.all(replies.map((response) => response.json()))
  assert.equal(seen.length, 4)
  assert.equal(sabi.recent.length, 4)
  assert.equal(new Set(sabi.recent.map((row) => row.sessionId)).size, 4)
  assert.equal(new Set(sabi.recent.map((row) => row.requestId)).size, 4)
  for (const [index, row] of sabi.recent.entries()) {
    assert.equal(row.sessionKnown, false)
    assert.equal(row.client, 'unknown')
    assert.match(row.requestId ?? '', /^[a-f0-9-]{36}$/)
    assert.ok(replies.some((response) => response.headers.get('x-sabi-request-id') === row.requestId), String(index))
    assert.equal(row.cost, undefined)
  }
})

test('explicit IDs are hashed, client-scoped and stripped with spoofed authority headers', async (t) => {
  const { post, sabi, seen } = await fixture(t)
  const headers = { 'x-sabi-client': 'opencode', 'x-sabi-session': 'private-session-1', 'x-sabi-turn': 'private-turn-1',
    'x-sabi-request-id': 'spoofed', authorization: 'Bearer client-secret', 'x-sabi-permission': 'allow-all' }
  await Promise.all([post({}, headers), post({}, headers), post({}, { ...headers, 'x-sabi-session': 'private-session-2' }),
    post({}, { ...headers, 'x-sabi-client': 'hermes' })])
  assert.equal(seen.length, 4)
  const opencode = sabi.recent.filter((row) => row.client === 'opencode')
  assert.deepEqual([...new Set(opencode.map((row) => row.sessionId))].map((id) =>
    opencode.filter((row) => row.sessionId === id).length).sort(), [1, 2])
  assert.equal(new Set(sabi.recent.map((row) => row.sessionId)).size, 3)
  for (const row of sabi.recent) {
    assert.equal(row.sessionKnown, true)
    assert.match(row.sessionId, /^[a-f0-9]{64}$/)
    assert.match(row.turnId ?? '', /^[a-f0-9]{64}$/)
    assert.notEqual(row.requestId, 'spoofed')
  }
  for (const request of seen) {
    assert.equal(request.headers.authorization, undefined)
    assert.ok(Object.keys(request.headers).every((name) => !name.startsWith('x-sabi-')))
  }
})

test('invalid opaque identity headers are rejected before any upstream call', async (t) => {
  const { post, seen } = await fixture(t)
  const invalidHeaders: Array<Record<string, string>> = [{ 'x-sabi-client': 'administrator' }, { 'x-sabi-session': 'bad value' },
    { 'x-sabi-session': 'a'.repeat(129) }, { 'x-sabi-turn': 'bad/value' }, { 'x-sabi-session': 'first, second' }]
  for (const headers of invalidHeaders) {
    const response = await post({}, headers)
    assert.equal(response.status, 400)
    await response.text()
  }
  assert.equal(seen.length, 0)
})

test('privacy canary: identifiers, tools, prompts and arbitrary upstream models never enter logs', async (t) => {
  const marker = 'sk-live-ABCDEF1234567890abcdef'
  const { post, sabi, logFile, seen } = await fixture(t, (_seen, res) => reply(res, marker))
  const messages = [{ role: 'user', content: marker },
    { role: 'assistant', tool_calls: [{ id: marker, type: 'function', function: { name: marker, arguments: JSON.stringify({ key: marker }) } }] },
    { role: 'tool', tool_call_id: marker, content: marker }]
  const tools = [{ type: 'function', function: { name: marker, parameters: { type: 'object' } } }]
  const response = await post({ messages, tools }, { 'x-sabi-client': 'prime-agent', 'x-sabi-session': marker, 'x-sabi-turn': marker })
  assert.equal(response.status, 200)
  assert.deepEqual(seen[0].body.messages, messages)
  assert.deepEqual(seen[0].body.tools, tools)
  assert.equal(sabi.recent[0].servedModel, undefined)
  assert.equal(sabi.recent[0].upstreamModel, 'mock-cheap')
  assert.ok(!readFileSync(logFile, 'utf8').includes(marker))
  assert.ok(!JSON.stringify(sabi.recent).includes(marker))
})

test('known served model is observed, missing usage and missing prices remain unknown', async (t) => {
  let count = 0
  const { post, sabi } = await fixture(t, (_seen, res) => reply(res, 'mock-cheap', ++count === 2 ? { usage: {} } : {}))
  await post()
  await post()
  assert.equal(sabi.recent[0].servedModel, 'mock-cheap')
  assert.equal(sabi.recent[0].usage?.promptTokens, 10)
  assert.equal(sabi.recent[0].cost, undefined)
  assert.equal(sabi.recent[1].usage, undefined)
  assert.equal(sabi.recent[1].cost, undefined)
})

test('fixed aliases preserve tool history, reasoning fields and pins without asking Jev', async (t) => {
  let judgeCalls = 0
  const { post, sabi, seen } = await fixture(t, (seen, res) => reply(res, seen.body.model),
    { judgeClient: { async ask() { judgeCalls += 1; throw new Error('must not run') } } }, (config) => {
      config.judge = { enabled: true, baseURL: 'http://127.0.0.1/unused', callOn: ['alias', 'failure'] }
    })
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'fix it' }] },
    { role: 'assistant', content: null, reasoning_content: 'opaque reasoning', tool_calls: [
      { id: 'tool-B', type: 'function', function: { name: 'mcp__Run', arguments: '{ "b": 2 }' } },
      { id: 'tool-A', type: 'function', function: { name: 'shell_command', arguments: '{"command":"npm test"}' } },
    ] }, { role: 'tool', tool_call_id: 'tool-A', content: 'Error: test failed' },
    { role: 'tool', tool_call_id: 'tool-B', content: 'user denied tool call' }]
  const response = await post({ model: 'sabi/sabi-cheap', messages })
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { model: string }).model, 'sabi-cheap')
  assert.deepEqual(seen[0].body.messages, messages)
  assert.equal(seen[0].body.model, 'mock-cheap')
  assert.equal(sabi.recent[0].mode, 'fixed')
  assert.equal(judgeCalls, 0)
  assert.equal(seen.length, 1)
})

test('429, auth errors and 5xx pass status and Retry-After without retries or raw error logs', async (t) => {
  let status = 429
  const marker = 'sk-live-errorCanaryABCDEF1234567890'
  const errorBody = { error: { message: marker, details: 'x'.repeat(4096) } }
  const { post, sabi, seen, logFile } = await fixture(t, (_seen, res) => {
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })
    res.end(JSON.stringify(errorBody))
  })
  for (const code of [429, 401, 503]) {
    status = code
    const response = await post()
    assert.equal(response.status, code)
    assert.equal(response.headers.get('retry-after'), 'Wed, 21 Oct 2026 07:28:00 GMT')
    assert.deepEqual(await response.json(), errorBody)
  }
  assert.equal(seen.length, 3)
  assert.deepEqual(sabi.recent.map((row) => row.outcome), ['transport', 'error', 'transport'])
  assert.ok(!readFileSync(logFile, 'utf8').includes(marker))
})

test('malformed nonstream and mismatched streaming replies fail once with 502', async (t) => {
  let payload = 'not JSON'
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(payload)
  })
  for (const body of ['not JSON', 'null', '[]', '{}', '{"error":{"message":"private"}}']) {
    payload = body
    assert.equal((await post()).status, 502)
  }
  payload = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'wrong mode' } }] })
  assert.equal((await post({ stream: true })).status, 502)
  assert.equal(seen.length, 6)
  assert.equal(sabi.recent.length, 6)
  assert.ok(sabi.recent.every((row) => row.outcome === 'error' && row.usage === undefined))
})

test('malformed SSE fails instead of completing or replaying tools', async (t) => {
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {broken}\n\n')
  })
  assert.equal((await post({ stream: true })).status, 502)
  assert.equal(sabi.recent[0].outcome, 'error')
  assert.equal(seen.length, 1)
})

test('client cancellation aborts a live stream and records exactly one aborted attempt', async (t) => {
  let upstreamClosed = false
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.on('close', () => { upstreamClosed = true })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"model":"mock-cheap","choices":[{"delta":{"content":"partial"}}]}\n\n')
  })
  const controller = new AbortController()
  const response = await post({ stream: true }, {}, controller.signal)
  const reader = response.body!.getReader()
  assert.equal((await reader.read()).done, false)
  controller.abort()
  await reader.cancel().catch(() => {})
  await until(() => upstreamClosed && sabi.recent.length === 1)
  assert.equal(sabi.recent[0].outcome, 'aborted')
  assert.equal(seen.length, 1)
})

test('total deadline cancels an upstream that never sends headers', async (t) => {
  let upstreamClosed = false
  const { post, sabi, seen } = await fixture(t, (_seen, res) => { res.on('close', () => { upstreamClosed = true }) },
    { requestTimeoutMs: 150 })
  const response = await post()
  assert.equal(response.status, 504)
  await until(() => upstreamClosed && sabi.recent.length === 1)
  assert.equal(sabi.recent[0].outcome, 'transport')
  assert.equal(sabi.recent[0].transport, 504)
  assert.equal(seen.length, 1)
})

test('deadline covers the judge and never dispatches the cancelled model request', async (t) => {
  let judgeAborted = false
  const { post, sabi, seen } = await fixture(t, undefined, { requestTimeoutMs: 150,
    judgeClient: { ask(_state, _questions, _config, signal) {
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => {
        judgeAborted = true
        reject(signal.reason)
      }, { once: true }))
    } },
  }, (config) => { config.judge = { enabled: true, baseURL: 'http://127.0.0.1/unused', callOn: ['first-turn'] } })
  assert.equal((await post()).status, 504)
  assert.equal(judgeAborted, true)
  assert.equal(seen.length, 0)
  assert.equal(sabi.recent.length, 1)
})

test('deadline also covers an incomplete request upload', async (t) => {
  const { url, seen } = await fixture(t, undefined, { requestTimeoutMs: 150 })
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100' } }, (res) => {
      res.resume()
      res.once('end', () => { req.destroy(); resolve(res.statusCode) })
    })
    req.on('error', reject)
    req.write('{')
  })
  assert.equal(status, 504)
  assert.equal(seen.length, 0)
})


test('a deadline terminates a stalled stream after headers with one transport record', async (t) => {
  let upstreamClosed = false
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.on('close', () => { upstreamClosed = true })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"model":"mock-cheap","choices":[{"delta":{"content":"partial"}}]}\n\n')
  }, { requestTimeoutMs: 150 })
  const response = await post({ stream: true })
  assert.equal(response.status, 200)
  await assert.rejects(() => response.text())
  await until(() => upstreamClosed && sabi.recent.length === 1)
  assert.equal(sabi.recent[0].outcome, 'transport')
  assert.equal(sabi.recent[0].transport, 504)
  assert.equal(seen.length, 1)
})

test('upstream disconnect and missing DONE never become successful streams', async (t) => {
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"model":"mock-cheap","choices":[{"delta":{"content":"partial"}}]}\n\n')
  })
  const response = await post({ stream: true })
  await assert.rejects(() => response.text())
  await until(() => sabi.recent.length === 1)
  assert.equal(sabi.recent[0].outcome, 'error')
  assert.equal(seen.length, 1)
})

test('DONE plus a usage-only final event completes without waiting for socket EOF', async (t) => {
  const events = [
    { model: 'mock-cheap', choices: [{ index: 0, delta: { tool_calls: [
      { index: 0, id: 'original-ID', type: 'function', function: { name: 'mcp__OriginalName', arguments: '{"file":' } },
    ] } }] },
    { model: 'mock-cheap', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"café.ts"}' } }] }, finish_reason: 'tool_calls' }] },
    { model: 'mock-cheap', choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
  ]
  let upstreamClosed = false
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.on('close', () => { upstreamClosed = true })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const bytes = Buffer.from(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    // Force the source write boundaries to bisect JSON and UTF-8. The socket may coalesce them.
    for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3))
  }, { requestTimeoutMs: 1000 })
  const response = await post({ stream: true })
  const text = await response.text()
  const observed = text.split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)))
  assert.deepEqual(observed, events.map((event) => ({ ...event, model: 'sabi-code' })))
  assert.equal(text.match(/\[DONE\]/g)?.length, 1)
  await until(() => upstreamClosed && sabi.recent.length === 1)
  assert.equal(sabi.recent[0].outcome, 'ok')
  assert.equal(sabi.recent[0].usage?.totalTokens, 14)
  assert.equal(sabi.recent[0].servedModel, 'mock-cheap')
  assert.equal(seen.length, 1)
})


test('a Jev mutation cannot bypass explicit backend compatibility', async (t) => {
  const { post, sabi, seen } = await fixture(t, undefined, { judgeClient: { async ask() {
    return { outcome: { realProblem: 0.9, difficulty: 'demanding', difficultyConfidence: 0.99 }, cached: false, latencyMs: 1 }
  } } }, (config) => {
    config.models.cheap.capabilities = { tools: true }
    config.models.strong.capabilities = { tools: false }
    config.judge = { enabled: true, baseURL: 'http://127.0.0.1/unused', callOn: ['unclassified'] }
  })
  const response = await post({ messages: [{ role: 'user', content: 'run it' },
    { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'unknown-tool', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'ready' }],
    tools: [{ type: 'function', function: { name: 'unknown-tool' } }] })
  assert.equal(response.status, 400)
  assert.match(await response.text(), /incompatible route/)
  assert.equal(seen.length, 0)
  assert.equal(sabi.recent[0].outcome, 'error')
  assert.equal(sabi.recent[0].judge?.overridden, true)
})

test('an upstream redirect is not followed or replayed', async (t) => {
  const { post, sabi, seen } = await fixture(t, (_seen, res) => {
    res.writeHead(307, { location: '/replayed-completion' })
    res.end()
  })
  assert.equal((await post()).status, 502)
  assert.equal(seen.length, 1)
  assert.equal(sabi.recent[0].outcome, 'error')
})

test('adaptive aliases omit a context window when any reachable backend window is unknown', async (t) => {
  const { url } = await fixture(t, undefined, {}, (config) => { config.models.cheap.contextWindow = 1000 })
  const response = await fetch(url.replace('/chat/completions', '/models'))
  const payload = await response.json() as { data: Array<{ id: string; context_window?: number }> }
  assert.equal(payload.data.find((model) => model.id === 'sabi-code')?.context_window, undefined)
  assert.equal(payload.data.find((model) => model.id === 'sabi-cheap')?.context_window, 1000)
})


test('adaptive window includes Jev targets even when the policy never names them', async (t) => {
  const { url } = await fixture(t, undefined, {}, (config) => {
    config.policy = { 'first-turn': 'cheap', unclassified: 'cheap' }
    config.models.cheap.contextWindow = 10000
    config.models.mid.contextWindow = 8000
    config.models.strong.contextWindow = 2000
    config.judge = { enabled: true, baseURL: 'http://127.0.0.1/unused', callOn: ['unclassified'] }
  })
  const response = await fetch(url.replace('/chat/completions', '/models'))
  const payload = await response.json() as { data: Array<{ id: string; context_window?: number }> }
  assert.equal(payload.data.find((model) => model.id === 'sabi-code')?.context_window, 2000)
  assert.equal(payload.data.find((model) => model.id === 'sabi-cheap')?.context_window, 10000)
})


test('unknown served models never inherit the requested model price', async (t) => {
  const { post, sabi } = await fixture(t, (_seen, res) => reply(res, 'mock-not-catalogued'), {}, (config) => {
    config.models.cheap.cost = { input: 1, output: 1 }
  })
  const response = await post()
  assert.equal(response.status, 200)
  await response.json()
  assert.equal(sabi.recent[0].servedModel, undefined)
  assert.equal(sabi.recent[0].usage?.totalTokens, 12)
  assert.equal(sabi.recent[0].cost, undefined)
})

test('adaptive model summary includes the implicit cheap fallback', async (t) => {
  const { url } = await fixture(t, undefined, {}, (config) => {
    config.policy = { 'first-turn': 'mid', unclassified: 'off' }
    config.models.cheap.contextWindow = 100
    config.models.mid.contextWindow = 10_000
    config.models.strong.contextWindow = 20_000
  })
  const response = await fetch(url.replace('/chat/completions', '/models'))
  assert.equal(response.status, 200)
  const payload = await response.json() as { data: Array<{ id: string; context_window?: number }> }
  assert.equal(payload.data.find((model) => model.id === 'sabi-code')?.context_window, 100)
})
