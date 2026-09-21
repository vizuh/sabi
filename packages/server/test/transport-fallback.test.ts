import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

// The upstream model ids below are synthetic fixtures, not live provider claims.
let mock: Server
let mockPort = 0
let requests: Array<Record<string, unknown>> = []
let failuresLeft = 0

let enabled: SabiServer
let enabledPort = 0
let enabledLog = ''
let disabled: SabiServer
let disabledPort = 0
let disabledLog = ''

function baseConfig(transportFallback?: { enabled: boolean }) {
  return validateConfig({
    upstreams: { mock: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: false } },
    models: {
      cheap: { upstream: 'mock', model: 'synthetic-cheap', cost: { input: 1, output: 2 } },
      mid: { upstream: 'mock', model: 'synthetic-mid', cost: { input: 5, output: 10 } },
    },
    aliases: { 'sabi-code': 'auto' },
    policy: { exploration: 'cheap', unclassified: 'cheap' },
    ...(transportFallback ? { transportFallback } : {}),
    judge: { enabled: false },
  })
}

const exploration = [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'find the auth code' },
  { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{"pattern":"auth"}' } }] },
  { role: 'tool', content: '3 matches' },
]

function readLog(file: string): DecisionRecord[] {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}

async function waitFor(file: string): Promise<DecisionRecord> {
  const deadline = Date.now() + 2000
  for (;;) {
    const rows = readLog(file)
    if (rows.length) return rows[rows.length - 1]
    if (Date.now() > deadline) throw new Error('timed out waiting for a decision')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

before(async () => {
  mock = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>
      requests.push(body)
      if (failuresLeft > 0) {
        failuresLeft -= 1
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
        res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }))
        return
      }
      const model = String(body.model ?? 'synthetic')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'c1', object: 'chat.completion', model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }))
    })
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => {
      mockPort = (mock.address() as { port: number }).port
      resolve()
    })
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-fallback-'))
  enabledLog = path.join(dir, 'enabled.jsonl')
  disabledLog = path.join(dir, 'disabled.jsonl')
  enabled = createSabiServer({ config: baseConfig({ enabled: true }), logFile: enabledLog, verbose: false })
  disabled = createSabiServer({ config: baseConfig(), logFile: disabledLog, verbose: false })
  enabledPort = await enabled.listen(0, '127.0.0.1')
  disabledPort = await disabled.listen(0, '127.0.0.1')
})

after(async () => {
  await enabled.close()
  await disabled.close()
  mock.close()
})

test('a 429 on the planned tier retries the next tier when enabled', async () => {
  requests = []
  failuresLeft = 1
  const response = await fetch(`http://127.0.0.1:${enabledPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: exploration }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json() as { model: string }
  assert.equal(payload.model, 'sabi-code')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].model, 'synthetic-cheap')
  assert.equal(requests[1].model, 'synthetic-mid')
  const record = await waitFor(enabledLog)
  assert.equal(record.rule, 'transport-fallback')
  assert.equal(record.tier, 'mid')
  assert.equal(record.fallback, 'mid')
  assert.equal(record.outcome, 'ok')
})

test('the first upstream error is served as-is when the fallback is off', async () => {
  requests = []
  failuresLeft = 1
  const response = await fetch(`http://127.0.0.1:${disabledPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: exploration }),
  })
  assert.equal(response.status, 429)
  assert.equal(requests.length, 1)
  const record = await waitFor(disabledLog)
  assert.equal(record.outcome, 'transport')
  assert.equal(record.fallback, undefined)
})
