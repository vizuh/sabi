import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

let mock: Server
let sabi: SabiServer
let sabiPort = 0
let logFile = ''
let upstreamCalls = 0

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

interface RawResponse {
  status: number
  text: string
}

function raw(options: {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: sabiPort,
        path: options.path,
        method: options.method,
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

function decisions(): string[] {
  try {
    return readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim().length > 0)
  } catch {
    return []
  }
}

const chatBody = JSON.stringify({
  model: 'sabi-code',
  stream: false,
  messages: [
    { role: 'system', content: 'agent' },
    { role: 'user', content: 'hello' },
  ],
})

before(async () => {
  mock = createServer((req, res) => {
    upstreamCalls += 1
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      )
    })
  })
  const mockPort = await listen(mock)
  const config = validateConfig({
    upstreams: { mock: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: false } },
    models: {
      cheap: { upstream: 'mock', model: 'mock-cheap' },
      mid: { upstream: 'mock', model: 'mock-mid' },
      strong: { upstream: 'mock', model: 'mock-strong' },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap' },
    policy: {
      failure: 'strong',
      'first-turn': 'cheap',
      verification: 'cheap',
      implementation: 'cheap',
      exploration: 'cheap',
      unclassified: 'cheap',
    },
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-loopback-'))
  logFile = path.join(dir, 'decisions.jsonl')
  sabi = createSabiServer({ config, logFile, verbose: false })
  sabiPort = await sabi.listen(0, '127.0.0.1')
})

after(async () => {
  await sabi.close()
  mock.close()
})

test('a cross-origin POST is rejected before any round executes', async () => {
  const before = decisions().length
  const response = await raw({
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: chatBody,
  })
  assert.equal(response.status, 403)
  assert.match(response.text, /forbidden origin/)
  assert.equal(upstreamCalls, 0)
  assert.equal(decisions().length, before)
})

test('a non-loopback Host is rejected, closing the DNS-rebinding read path', async () => {
  const response = await raw({ method: 'GET', path: '/decisions', headers: { host: 'evil.example' } })
  assert.equal(response.status, 403)
  assert.match(response.text, /forbidden host/)
})

test('an evil Referer on a read-only surface is rejected', async () => {
  const response = await raw({ method: 'GET', path: '/decisions', headers: { referer: 'https://evil.example/' } })
  assert.equal(response.status, 403)
})

test('a CORS simple request without JSON is rejected instead of executed', async () => {
  const before = decisions().length
  const response = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: chatBody,
  })
  assert.equal(response.status, 415)
  assert.equal(upstreamCalls, 0)
  assert.equal(decisions().length, before)
})

test('a POST with no content-type at all is rejected instead of executed', async () => {
  const before = decisions().length
  const response = await raw({ method: 'POST', path: '/v1/chat/completions', body: chatBody })
  assert.equal(response.status, 415)
  assert.equal(upstreamCalls, 0)
  assert.equal(decisions().length, before)
})

test('loopback origins and ordinary local clients still work', async () => {
  const plain = await fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: chatBody,
  })
  assert.equal(plain.status, 200)

  const loopbackOrigin = await raw({
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4000' },
    body: chatBody,
  })
  assert.equal(loopbackOrigin.status, 200)

  const ipv6LoopbackOrigin = await raw({
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', origin: 'http://[::1]:4000' },
    body: chatBody,
  })
  assert.equal(ipv6LoopbackOrigin.status, 200)

  const read = await raw({ method: 'GET', path: '/decisions' })
  assert.equal(read.status, 200)
})

test('healthz no longer leaks the absolute log path', async () => {
  const response = await fetch(`http://127.0.0.1:${sabiPort}/healthz`)
  assert.equal(response.status, 200)
  const payload = (await response.json()) as Record<string, unknown>
  assert.equal(payload.ok, true)
  assert.ok(Array.isArray(payload.models))
  assert.ok(!('log' in payload), 'absolute log path must not be exposed')
  assert.ok(!JSON.stringify(payload).includes(path.dirname(logFile)), 'no host filesystem path may leak')
})
