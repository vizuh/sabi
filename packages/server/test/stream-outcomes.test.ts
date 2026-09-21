import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

let mock: Server
let sabi: SabiServer
let sabiPort = 0
let logFile = ''
let mode: 'latin429' | 'midstream-error' | 'no-done' = 'latin429'

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
    req.resume()
    req.on('end', () => {
      if (mode === 'latin429') {
        // A provider 429 whose body is not UTF-8 (Latin-1 HTML page): status, Retry-After
        // and the transport classification must survive the decode.
        const latin1 = Buffer.from([0x3c, 0x68, 0x31, 0x3e, 0xe9, 0x3c, 0x2f, 0x68, 0x31, 0x3e])
        res.writeHead(429, { 'content-type': 'text/html', 'retry-after': '2' })
        res.end(latin1)
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (mode === 'midstream-error') {
        res.write(`data: ${JSON.stringify({ model: 'mock-cheap', choices: [{ index: 0, delta: { content: 'partial' } }] })}\n\n`)
        // Delay the failure so it arrives after the first bytes were already forwarded
        // (headers committed): that is the mid-stream case, not a pre-headers failure.
        setTimeout(() => {
          res.write(`data: ${JSON.stringify({ error: { message: 'credit exhausted for this round', code: 402 } })}\n\n`)
          res.end()
        }, 15)
        return
      }
      // A clean stream that simply omits the [DONE] sentinel: terminal choice + usage, then EOF.
      res.write(`data: ${JSON.stringify({ model: 'mock-cheap', choices: [{ index: 0, delta: { content: 'ok' } }] })}\n\n`)
      res.write(
        `data: ${JSON.stringify({ model: 'mock-cheap', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } })}\n\n`,
      )
      res.end()
    })
  })
  return listen(server).then((port) => ({ server, port }))
}

function readDecisions(): DecisionRecord[] {
  try {
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as DecisionRecord)
  } catch {
    return []
  }
}

const system = { role: 'system', content: 'agent' }
const user = { role: 'user', content: 'hello' }
const exploration = [
  system,
  user,
  { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{}' } }] },
  { role: 'tool', content: '2 matches' },
]

before(async () => {
  const started = await startMockUpstream()
  mock = started.server
  const config = validateConfig({
    upstreams: { mock: { baseURL: `http://127.0.0.1:${started.port}/v1`, apiKey: false } },
    models: { cheap: { upstream: 'mock', model: 'mock-cheap' } },
    aliases: { 'sabi-code': 'auto' },
    policy: { 'first-turn': 'cheap', exploration: 'cheap', unclassified: 'cheap' },
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-stream-'))
  logFile = path.join(dir, 'decisions.jsonl')
  sabi = createSabiServer({ config, logFile, verbose: false })
  sabiPort = await sabi.listen(0, '127.0.0.1')
})

after(async () => {
  await sabi.close()
  mock.close()
})

test('a non-UTF-8 429 keeps its status, Retry-After and transport outcome', async () => {
  mode = 'latin429'
  const before = readDecisions().length
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [system, user] }),
  })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '2')
  await response.text()
  const rows = readDecisions()
  assert.equal(rows.length, before + 1)
  assert.equal(rows[rows.length - 1]?.outcome, 'transport')
  assert.equal(rows[rows.length - 1]?.transport, 429)
})

test('a provider error mid-stream ends with an explicit error frame, not a silent truncation', async () => {
  mode = 'midstream-error'
  const before = readDecisions().length
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: true, messages: exploration }),
  })
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.match(text, /"error"/)
  assert.match(text, /credit exhausted/)
  const rows = readDecisions()
  assert.equal(rows.length, before + 1)
  assert.equal(rows[rows.length - 1]?.outcome, 'error')
})

test('a clean stream without [DONE] completes with its usage intact', async () => {
  mode = 'no-done'
  const before = readDecisions().length
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: true, messages: exploration }),
  })
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.match(text, /ok/)
  const rows = readDecisions()
  assert.equal(rows.length, before + 1)
  const record = rows[rows.length - 1]!
  assert.equal(record.outcome, 'ok')
  assert.equal(record.usage?.totalTokens, 45)
})
