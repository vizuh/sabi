import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

// Two :free models share OpenRouter's daily pool, but a 429 only speaks for the
// whole pool when the platform enforced it (X-RateLimit-* headers). A provider's
// own 429 for one model must not stop Sabi from trying the other free model.
// Model ids are synthetic fixtures.
let mock: Server
let sabi: SabiServer
let port = 0
let requests: string[] = []
let refuseWith: Record<string, string> | undefined
let poolSpentMidChain = false

before(async () => {
  mock = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const model = String((JSON.parse(raw) as { model?: string }).model)
      requests.push(model)
      if (model === 'vendor/busy:free' && refuseWith) {
        res.writeHead(429, { 'content-type': 'application/json', ...refuseWith })
        res.end(JSON.stringify({ error: { message: 'rate limited' } }))
        return
      }
      if (model === 'vendor/healthy:free' && poolSpentMidChain) {
        res.writeHead(429, { 'content-type': 'application/json', 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '0' })
        res.end(JSON.stringify({ error: { message: 'rate limited' } }))
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
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()))
  const mockPort = (mock.address() as { port: number }).port
  sabi = createSabiServer({
    config: validateConfig({
      upstreams: { mock: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: false } },
      models: {
        cheap: { upstream: 'mock', model: 'vendor/busy:free', cost: { input: 0, output: 0 } },
        mid: { upstream: 'mock', model: 'vendor/healthy:free', cost: { input: 0, output: 0 } },
        next: { upstream: 'mock', model: 'vendor/third:free', cost: { input: 0, output: 0 } },
      },
      aliases: { 'sabi-code': 'auto' },
      policy: { unclassified: 'cheap' },
      transportFallback: { enabled: true },
      judge: { enabled: false },
    }),
    logFile: path.join(mkdtempSync(path.join(os.tmpdir(), 'sabi-free-429-')), 'decisions.jsonl'),
    verbose: false,
  })
  port = await sabi.listen(0, '127.0.0.1')
})

after(async () => {
  await sabi.close()
  mock.close()
})

async function ask(): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
  })
  await response.body?.cancel()
  return response.status
}

test('a provider 429 on one :free model falls back to another :free model', async () => {
  requests = []
  refuseWith = {}
  assert.equal(await ask(), 200)
  assert.deepEqual(requests, ['vendor/busy:free', 'vendor/healthy:free'])
})

test('a platform-enforced 429 (X-RateLimit headers) still leaves the shared pool', async () => {
  requests = []
  refuseWith = { 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790700000000' }
  assert.equal(await ask(), 429)
  assert.deepEqual(requests, ['vendor/busy:free'])
})

test('a platform 429 met during fallback skips the rest of that pool', async () => {
  requests = []
  refuseWith = {}
  poolSpentMidChain = true
  assert.equal(await ask(), 429)
  // busy (provider 429) -> healthy (platform 429, pool spent) -> third is in the same pool: not tried.
  assert.deepEqual(requests, ['vendor/busy:free', 'vendor/healthy:free'])
  poolSpentMidChain = false
})
