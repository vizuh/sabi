import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

/**
 * The fallback recompute. The percentage comes from the round's own state and does not depend on the
 * tier, but the level does: 33% is band 0 of three (`low` on cheap) and band 1 of four (`medium` on
 * mid). Without the second `applyEffortSchedule` call the record would keep cheap's `low` while the
 * round was actually served by mid — a telemetry lie that this file fails on.
 */
const BLOCK = {
  enabled: true,
  mode: 'observe',
  scale: { min: 0, max: 100 },
  bands: 'uniform',
  // No `default`, on purpose: proves validation accepts ladders resolved purely per tier, and that
  // the two tiers really do have different ladders.
  ladders: { cheap: ['low', 'medium', 'high'], mid: ['low', 'medium', 'high', 'xhigh'] },
  curve: {},
  floorLevel: {},
  judge: { weight: 0.5, minConfidence: 0.25, percent: { trivial: 20, standard: 50, demanding: 90 } },
}

/** Unclassified round: the last role is the assistant, with an assistant turn already behind it. */
const ROUND = [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'roda os testes' },
  { role: 'assistant', content: 'ok' },
]

interface Harness {
  port: number
  log: string
  requests: Array<Record<string, unknown>>
  close: () => Promise<void>
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

async function start(failures: number): Promise<Harness> {
  const requests: Array<Record<string, unknown>> = []
  let failuresLeft = failures
  const mock = createServer((req, res) => {
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
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'c1', object: 'chat.completion', model: String(body.model),
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }))
    })
  })
  const mockPort = await listen(mock)
  const config = validateConfig({
    upstreams: { mock: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: false } },
    models: {
      cheap: { upstream: 'mock', model: 'mock-cheap' },
      mid: { upstream: 'mock', model: 'mock-mid' },
    },
    aliases: { 'sabi-code': 'auto' },
    policy: {
      'first-turn': 'mid', verification: 'mid', implementation: 'mid', failure: 'mid',
      exploration: 'cheap', unclassified: 'cheap',
    },
    transportFallback: { enabled: true },
    judge: { enabled: false },
    telemetry: { allowlistOnly: true, captureSnippets: false },
    effortScheduling: BLOCK as never,
  })
  const log = path.join(mkdtempSync(path.join(os.tmpdir(), 'sabi-effort-fallback-')), 'decisions.jsonl')
  const sabi: SabiServer = createSabiServer({ config, logFile: log, verbose: false })
  const port = await sabi.listen(0, '127.0.0.1')
  return {
    port, log, requests,
    close: async () => { await sabi.close(); mock.close() },
  }
}

async function round(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', stream: false, max_tokens: 16, messages: ROUND }),
  })
  assert.equal(response.status, 200)
  await response.text()
}

async function waitForRecord(log: string): Promise<DecisionRecord> {
  const deadline = Date.now() + 2000
  for (;;) {
    const rows = readFileSync(log, 'utf8').split('\n').filter((line) => line.trim().length > 0)
    if (rows.length > 0) return JSON.parse(rows[rows.length - 1]) as DecisionRecord
    if (Date.now() > deadline) throw new Error('timed out waiting for a decision record')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('a successful fallback recomputes the level against the FINAL tier ladder', async () => {
  const harness = await start(1)
  try {
    await round(harness.port)
    const record = await waitForRecord(harness.log)
    assert.equal(harness.requests.length, 2)
    assert.equal(harness.requests[0].model, 'mock-cheap')
    assert.equal(harness.requests[1].model, 'mock-mid')
    for (const request of harness.requests) {
      assert.equal(Object.hasOwn(request, 'reasoning_effort'), false)
      assert.deepEqual(
        Object.keys(request).sort(),
        ['max_tokens', 'messages', 'model', 'stream'],
      )
    }
    assert.equal(record.rule, 'transport-fallback')
    assert.equal(record.tier, 'mid')
    assert.equal(record.fallback, 'mid')
    assert.equal(record.outcome, 'ok')
    assert.equal(record.effortPercent, 33)
    assert.equal(record.effortIndex, 1)
    assert.equal(record.effortLevel, 'medium')
    assert.deepEqual(record.effortLadder, ['low', 'medium', 'high', 'xhigh'])
  } finally {
    await harness.close()
  }
})

test('without a fallback the planned tier ladder is the one recorded', async () => {
  const harness = await start(0)
  try {
    await round(harness.port)
    const record = await waitForRecord(harness.log)
    assert.equal(harness.requests.length, 1)
    assert.equal(harness.requests[0].model, 'mock-cheap')
    assert.equal(record.tier, 'cheap')
    assert.equal(record.outcome, 'ok')
    assert.equal(record.effortPercent, 33)
    assert.equal(record.effortIndex, 0)
    assert.equal(record.effortLevel, 'low')
    assert.deepEqual(record.effortLadder, ['low', 'medium', 'high'])
  } finally {
    await harness.close()
  }
})
