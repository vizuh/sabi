import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashIdentity, validateConfig, type DecisionRecord, type JudgeOutcome } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'
import type { JudgeClient } from '../src/typesafe.ts'

let mock: Server
let sabi: SabiServer
let sabiPort = 0
let logFile = ''
let mockBodies: Array<Record<string, unknown>> = []
let mockHeaders: Array<Record<string, string>> = []
let mock429 = false
let mockStreamError: string | undefined

const defaultJudge: JudgeOutcome = { realProblem: 0.9, difficulty: 'standard', difficultyConfidence: 0.9 }
let judgeOutcome: JudgeOutcome = defaultJudge
let judgeThrows = false
let judgeCalls = 0

let lastJudgeState: Record<string, unknown> | undefined

const stubJudge: JudgeClient = {
  async ask(state) {
    judgeCalls += 1
    lastJudgeState = state as Record<string, unknown>
    if (judgeThrows) throw new Error('typesafe unavailable')
    return { outcome: { ...judgeOutcome, model: 'jev-1.13.0', usage: { inputTokens: 400, outputTokens: 30 } }, cached: false, latencyMs: 7 }
  },
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

function startMockUpstream(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>
      mockBodies.push(body)
      const headers: Record<string, string> = {}
      for (const name of Object.keys(req.headers)) headers[name] = String(req.headers[name])
      mockHeaders.push(headers)
      if (mock429) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
        res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }))
        return
      }
      const model = String(body.model ?? 'mock-model')
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ id: 'c1', model, choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`,
        )
        if (mockStreamError) {
          // A provider failure delivered after content has already streamed, the way OpenRouter
          // reports 402s: the client keeps its 200 and the round still has to be recorded.
          setTimeout(() => {
            res.write(`data: ${JSON.stringify({ error: { message: mockStreamError, code: 402 } })}\n\n`)
            res.end()
          }, 15)
          return
        }
        res.write(
          `data: ${JSON.stringify({ id: 'c1', model, choices: [{ index: 0, delta: { content: 'hi' } }] })}\n\n`,
        )
        res.write(
          `data: ${JSON.stringify({
            id: 'c1',
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          })}\n\n`,
        )
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'c2',
          object: 'chat.completion',
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 40 },
          },
        }),
      )
    })
  })
  return listen(server).then((port) => ({ server, port }))
}

async function readDecisions(): Promise<DecisionRecord[]> {
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DecisionRecord)
}

async function waitForDecision(count: number): Promise<DecisionRecord[]> {
  const deadline = Date.now() + 2000
  for (;;) {
    const rows = await readDecisions()
    if (rows.length >= count) return rows
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} decisions (have ${rows.length})`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

before(async () => {
  const started = await startMockUpstream()
  mock = started.server
  const mockPort = started.port
  const config = validateConfig({
    upstreams: {
      mock: {
        baseURL: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: false,
        streamUsage: true,
        // Configured routing metadata, in normal HTTP casing: it must never reach the provider.
        // `x-title` is the control — ordinary vendor headers still pass through.
        headers: { 'X-Sabi-Session-Id': 'configured-session-1', 'X-Sabi-Request-Id': 'configured-request-1', 'x-title': 'sabi-test' },
      },
    },
    models: {
      cheap: { upstream: 'mock', model: 'mock-cheap', cost: { input: 1, output: 2 } },
      mid: { upstream: 'mock', model: 'mock-mid', cost: { input: 5, output: 10 } },
      strong: { upstream: 'mock', model: 'mock-strong', cost: { input: 10, output: 20, cacheRead: 1 } },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap', 'sabi-strong': 'strong' },
    policy: {
      failure: 'strong',
      'first-turn': 'mid',
      verification: 'mid',
      implementation: 'mid',
      exploration: 'cheap',
      unclassified: 'cheap',
    },
    judge: { enabled: true, baseURL: 'https://api.typesafe.ai/v1', callOn: ['failure', 'unclassified'] },
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-test-'))
  logFile = path.join(dir, 'decisions.jsonl')
  sabi = createSabiServer({ config, logFile, verbose: false, judgeClient: stubJudge })
  sabiPort = await sabi.listen(0, '127.0.0.1')
})

after(async () => {
  await sabi.close()
  mock.close()
})

const system = { role: 'system', content: 'you are a coding agent' }
const user = { role: 'user', content: 'find the auth code' }

test('streaming exploration round is routed to cheap and rewritten to the alias', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'sabi-code',
      stream: true,
      messages: [
        system,
        user,
        { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{"pattern":"auth"}' } }] },
        { role: 'tool', content: '3 matches' },
      ],
    }),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  const text = await response.text()
  assert.match(text, /"model":"sabi-code"/)
  assert.match(text, /data: \[DONE\]/)

  const rows = await waitForDecision(1)
  const record = rows[0]
  assert.equal(record.tier, 'cheap')
  assert.equal(record.rule, 'exploration')
  assert.equal(record.mode, 'auto')
  assert.equal(record.usage?.promptTokens, 50)
  assert.equal(record.stream, true)
  assert.equal(record.outcome, 'ok')

  const upstreamBody = mockBodies[mockBodies.length - 1]
  assert.equal(upstreamBody?.model, 'mock-cheap')
  assert.deepEqual(upstreamBody?.stream_options, { include_usage: true })
})

test('failing test output escalates to strong and costs are estimated', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'sabi-code',
      stream: false,
      messages: [
        system,
        user,
        { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
        { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
      ],
    }),
  })
  assert.equal(response.status, 200)
  const json = (await response.json()) as { model?: string }
  assert.equal(json.model, 'sabi-code')

  const rows = await waitForDecision(2)
  const record = rows[1]
  assert.equal(record.tier, 'strong')
  assert.equal(record.rule, 'failure')
  assert.equal(record.upstreamModel, 'mock-strong')
  assert.ok(record.cost)
  const expected = (60 * 10 + 40 * 1) / 1e6 + (20 * 20) / 1e6
  assert.ok(Math.abs((record.cost?.total ?? 0) - expected) < 1e-9)
  assert.equal(record.usage?.cachedTokens, 40)
})

test('fixed aliases bypass the policy', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi/sabi-cheap', stream: false, messages: [system, user] }),
  })
  assert.equal(response.status, 200)
  const rows = await waitForDecision(3)
  const record = rows[2]
  assert.equal(record.mode, 'fixed')
  assert.equal(record.tier, 'cheap')
  assert.equal(record.rule, 'alias')
})

test('unknown aliases are rejected with 404', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-nope', messages: [user] }),
  })
  assert.equal(response.status, 404)
  const payload = (await response.json()) as { error?: { message?: string } }
  assert.match(payload.error?.message ?? '', /unknown model/)
})

test('the models endpoint lists the synthetic aliases', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/models`)
  assert.equal(response.status, 200)
  const payload = (await response.json()) as { data?: Array<{ id?: string }> }
  const ids = (payload.data ?? []).map((entry) => entry.id)
  assert.deepEqual(ids.sort(), ['sabi-cheap', 'sabi-code', 'sabi-strong'])
})

async function postChat(payload: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function lastDecision(): Promise<DecisionRecord> {
  const rows = await readDecisions()
  const record = rows[rows.length - 1]
  assert.ok(record)
  return record
}

const failingConversation = [
  system,
  user,
  { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
  { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
]

const unclassifiedConversation = [
  system,
  user,
  { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"docker ps"}' } }] },
  { role: 'tool', content: 'CONTAINER ID  IMAGE  STATUS' },
]

test('jev vetoes a false escalation when the failure is expected', async () => {
  judgeOutcome = { realProblem: 0.05, difficulty: 'standard', difficultyConfidence: 0.9 }
  const response = await postChat({ model: 'sabi-code', stream: false, messages: failingConversation })
  assert.equal(response.status, 200)
  const record = await lastDecision()
  assert.equal(record.rule, 'verification')
  assert.equal(record.tier, 'mid')
  assert.equal(record.judge?.overridden, true)
  assert.equal(record.judge?.direction, 'down')
  assert.equal(record.judge?.realProblem, 0.05)
  assert.equal(mockBodies[mockBodies.length - 1]?.model, 'mock-mid')
  judgeOutcome = defaultJudge
})

test('a judge failure falls back to the deterministic decision', async () => {
  judgeThrows = true
  const response = await postChat({ model: 'sabi-code', stream: false, messages: unclassifiedConversation })
  assert.equal(response.status, 200)
  const record = await lastDecision()
  assert.equal(record.rule, 'unclassified')
  assert.equal(record.tier, 'cheap')
  assert.equal(record.judge?.status, 'error')
  assert.match(String(record.judge?.note), /typesafe unavailable/)
  judgeThrows = false
})

test('jev upgrades an unclassified round when the step is demanding', async () => {
  judgeOutcome = { realProblem: 0.9, difficulty: 'demanding', difficultyConfidence: 0.95 }
  const response = await postChat({ model: 'sabi-code', stream: false, messages: unclassifiedConversation })
  assert.equal(response.status, 200)
  const record = await lastDecision()
  assert.equal(record.tier, 'strong')
  assert.equal(record.judge?.overridden, true)
  assert.equal(record.judge?.direction, 'up')
  assert.equal(record.judge?.difficulty, 'demanding')
  assert.equal(mockBodies[mockBodies.length - 1]?.model, 'mock-strong')
  judgeOutcome = defaultJudge
})

test('state-conditioned judge evidence stays bounded for oversized turns', async () => {
  const response = await postChat({
    model: 'sabi-code',
    stream: false,
    messages: [
      system,
      { role: 'user', content: `inspect the auth flow ${'x'.repeat(12000)}` },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: `Tests: 1 failed\n${'x'.repeat(12000)}` },
    ],
  })
  assert.equal(response.status, 200)
  assert.ok(lastJudgeState)
  assert.ok(JSON.stringify(lastJudgeState).length <= 6000)
  assert.ok(lastJudgeState.evidence)
})

test('the judge is not called for rounds outside callOn', async () => {
  const before = judgeCalls
  await postChat({
    model: 'sabi-code',
    stream: false,
    messages: [
      system,
      user,
      { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{}' } }] },
      { role: 'tool', content: '2 matches' },
    ],
  })
  assert.equal(judgeCalls, before)
})

test('decision records never embed secret-like markers (canary)', async () => {
  const marker = 'sk-live-ABCDEF1234567890abcdef'
  const response = await postChat({
    model: 'sabi-code',
    stream: false,
    messages: [
      system,
      { role: 'user', content: `use the key ${marker}` },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"echo hi"}' } }] },
      { role: 'tool', content: `${marker} in output` },
    ],
  })
  assert.equal(response.status, 200)
  const rows = await readDecisions()
  const serialized = JSON.stringify(rows)
  assert.ok(!serialized.includes('sk-live-ABCDEF1234567890abcdef'))
  assert.ok(!serialized.includes('use the key'))
})

test('an upstream 429 is recorded as a transport outcome, distinct from a task error', async () => {
  mock429 = true
  const callsBefore = mockBodies.length
  const response = await postChat({ model: 'sabi-code', stream: false, messages: [system, user] })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '1')
  assert.equal(mockBodies.length, callsBefore + 1)
  const rows = await readDecisions()
  const record = rows[rows.length - 1]
  assert.equal(record.outcome, 'transport')
  assert.equal(record.transport, 429)
  mock429 = false
})

test('client-supplied identity headers are ignored and never persisted raw', async () => {
  const before = (await readDecisions()).length
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // An earlier attribution scheme accepted these; they are correlation keys at best and may
      // carry anything the client likes, so they are not identity and must not be recorded.
      'x-request-id': 'client-req-123',
      'x-session-id': 'client-sess-456',
    },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  assert.equal(response.status, 200)
  const echoed = response.headers.get('x-sabi-request-id')
  assert.ok(echoed && echoed.length > 0)

  const rows = await readDecisions()
  assert.equal(rows.length, before + 1)
  const record = rows[rows.length - 1]!
  assert.equal(record.requestId, echoed)
  assert.notEqual(record.requestId, 'client-req-123')
  assert.equal(record.client, 'unknown')
  const persisted = JSON.stringify(record)
  assert.ok(!persisted.includes('client-req-123'), 'client request id must not be persisted')
  assert.ok(!persisted.includes('client-sess-456'), 'client session id must not be persisted')

  const upstreamHeaders = mockHeaders[mockHeaders.length - 1] ?? {}
  assert.equal(upstreamHeaders['x-request-id'], undefined)
  assert.equal(upstreamHeaders['x-session-id'], undefined)
})

test('an accepted session identity is persisted hashed, never verbatim', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sabi-client': 'opencode',
      'x-sabi-session': 'opaque-session-1',
      'x-sabi-turn': 'turn-1',
    },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  assert.equal(response.status, 200)

  const record = (await readDecisions()).at(-1)!
  assert.equal(record.client, 'opencode')
  assert.equal(record.sessionKnown, true)
  const hashed = hashIdentity('session', 'opencode', 'opaque-session-1')
  assert.equal(record.sessionId, hashed)
  assert.equal(record.turnId, hashIdentity('turn', 'opencode', hashed, 'turn-1'))
  assert.ok(!JSON.stringify(record).includes('opaque-session-1'), 'the raw session id must not survive')
})

test('a non-opaque identity header is refused before anything is written', async () => {
  const before = (await readDecisions()).length
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sabi-session': 'not opaque; secret=abc' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  assert.equal(response.status, 400)
  assert.equal((await readDecisions()).length, before)
})

test('configured upstream headers that look like routing metadata are stripped case-insensitively', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  assert.equal(response.status, 200)
  const upstreamHeaders = mockHeaders[mockHeaders.length - 1] ?? {}
  assert.equal(upstreamHeaders['x-sabi-session-id'], undefined, 'X-Sabi-Session-Id must be stripped')
  assert.equal(upstreamHeaders['x-sabi-request-id'], undefined, 'X-Sabi-Request-Id must be stripped')
  assert.equal(upstreamHeaders['x-title'], 'sabi-test')
})

test('a provider error inside a 200 stream is recorded with the provider message', async () => {
  const before = (await readDecisions()).length
  mockStreamError = 'This request requires more credits, or fewer max_tokens'
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: true, messages: [system, user] }),
  })
  // The upstream already opened with 200, so the status cannot be corrected; the server resets the
  // stream, and the log is where the provider's explanation has to survive.
  assert.equal(response.status, 200)
  await response.text().catch(() => '')
  const rows = await waitForDecision(before + 1)
  mockStreamError = undefined

  const record = rows[rows.length - 1]!
  assert.equal(record.outcome, 'error')
  assert.equal(record.stream, true)
  assert.match(String(record.error), /requires more credits/)
})

test('a billed total floors the next round of the same session and marks the context measured', async () => {
  const before = (await readDecisions()).length
  const headers = { 'content-type': 'application/json', 'x-sabi-session': 'measured-context-1' }
  const first = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  await first.json()
  const firstRecord = (await waitForDecision(before + 1)).at(-1)!
  assert.equal(firstRecord.usage?.totalTokens, 120)
  assert.equal(firstRecord.state.contextKnown, false, 'the first request has nothing measured yet')

  const second = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'sabi-code',
      stream: false,
      messages: [system, user, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'again' }],
    }),
  })
  await second.json()
  const secondRecord = (await waitForDecision(before + 2)).at(-1)!
  assert.equal(secondRecord.state.contextKnown, true)
  assert.equal(secondRecord.state.contextTokens, 120, 'the provider-billed total floors the estimate')

  // A different session gets nothing: continuity is claimed only where it was proven.
  const third = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sabi-session': 'measured-context-2' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  await third.json()
  const thirdRecord = (await waitForDecision(before + 3)).at(-1)!
  assert.equal(thirdRecord.state.contextKnown, false)
})

test('a transcript that stays much smaller is a host compaction: generation advances on the second small request', async () => {
  const before = (await readDecisions()).length
  const headers = { 'content-type': 'application/json', 'x-sabi-session': 'compaction-session-1' }
  const failingRound = [
    { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
    { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
  ]
  const longMessages = [system, user, ...failingRound, ...failingRound, ...failingRound, ...failingRound]
  const first = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: longMessages }),
  })
  await first.json()
  const firstRecord = (await waitForDecision(before + 1)).at(-1)!
  assert.equal(firstRecord.state.contextGeneration, undefined)
  assert.equal(firstRecord.usage?.totalTokens, 120)

  // The host rewrote everything into a summary: the next request is less than half the size.
  // One small request alone only arms a candidate — a second consumer sharing the session
  // identity looks the same — so the measured floor and the generation are kept fail-open.
  const second = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: unclassifiedConversation }),
  })
  await second.json()
  const secondRecord = (await waitForDecision(before + 2)).at(-1)!
  assert.equal(secondRecord.state.contextGeneration, undefined)
  assert.equal(secondRecord.state.contextKnown, true)
  assert.equal((lastJudgeState?.round as Record<string, unknown> | undefined)?.context_generation, 0)

  // The shrink persists on the next request, so it confirms as a host compaction.
  const third = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: unclassifiedConversation }),
  })
  await third.json()
  const thirdRecord = (await waitForDecision(before + 3)).at(-1)!
  assert.equal(thirdRecord.state.contextGeneration, 1)
  // The measured size described the pre-compaction transcript, so it is not carried across.
  assert.equal(thirdRecord.state.contextKnown, false)
  // Jev sees the boundary too, which is what changes the cache key across it.
  assert.equal((lastJudgeState?.round as Record<string, unknown> | undefined)?.context_generation, 1)
})

test('a single small request sharing a session identity is not a compaction', async () => {
  const before = (await readDecisions()).length
  const headers = { 'content-type': 'application/json', 'x-sabi-session': 'compaction-session-shared-1' }
  const failingRound = [
    { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
    { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
  ]
  const longMessages = [system, user, ...failingRound, ...failingRound, ...failingRound, ...failingRound]
  const first = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: longMessages }),
  })
  await first.json()
  await waitForDecision(before + 1)

  // A second consumer reuses the same session identity with a smaller transcript: arms only.
  const second = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: unclassifiedConversation }),
  })
  await second.json()
  const secondRecord = (await waitForDecision(before + 2)).at(-1)!
  assert.equal(secondRecord.state.contextGeneration, undefined)
  assert.equal(secondRecord.state.contextKnown, true)

  // The original consumer returns at full size: the candidate recovers, no generation advances.
  const third = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: longMessages }),
  })
  await third.json()
  const thirdRecord = (await waitForDecision(before + 3)).at(-1)!
  assert.equal(thirdRecord.state.contextGeneration, undefined)
  assert.equal(thirdRecord.state.contextKnown, true)
  assert.equal((lastJudgeState?.round as Record<string, unknown> | undefined)?.context_generation, 0)
})
