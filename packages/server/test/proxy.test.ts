import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord, type JudgeOutcome } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'
import type { JudgeClient } from '../src/typesafe.ts'

let mock: Server
let sabi: SabiServer
let sabiPort = 0
let logFile = ''
let mockBodies: Array<Record<string, unknown>> = []

const defaultJudge: JudgeOutcome = { realProblem: 0.9, difficulty: 'standard', difficultyConfidence: 0.9 }
let judgeOutcome: JudgeOutcome = defaultJudge
let judgeThrows = false
let judgeCalls = 0

const stubJudge: JudgeClient = {
  async ask() {
    judgeCalls += 1
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
      const model = String(body.model ?? 'mock-model')
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ id: 'c1', model, choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`,
        )
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
      mock: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: false, streamUsage: true },
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
