import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

/**
 * The whole visible surface of this feature in `observe` mode: the percentage and the level are
 * recorded per round, and the request the upstream receives is byte-for-byte what the client sent.
 * The strongest assertion in this file is the key-set comparison — a single injected key would fail
 * it, which is what keeps F1 (observe) from silently becoming F2 (override).
 */
const BLOCK = {
  enabled: true,
  mode: 'observe',
  scale: { min: 0, max: 100 },
  bands: 'uniform',
  ladders: { default: ['low', 'medium', 'high'] },
  curve: { default: 1.0 },
  floorLevel: { default: 'low' },
  judge: { weight: 0.5, minConfidence: 0.25, percent: { trivial: 20, standard: 50, demanding: 90 } },
}

/** Implementation round (D1 = 47) — the same shape as the P9 `b` probe. */
const ROUND = [
  { role: 'user', content: 'aplica o patch' },
  {
    role: 'assistant',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'edit_file', arguments: '{"path":"a.ts"}' } }],
  },
  { role: 'tool', tool_call_id: 'call_1', content: 'patched ok' },
]

interface Harness {
  port: number
  log: string
  bodies: Array<Record<string, unknown>>
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

async function start(block?: unknown): Promise<Harness> {
  const bodies: Array<Record<string, unknown>> = []
  const mock = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>
      bodies.push(body)
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
      strong: { upstream: 'mock', model: 'mock-strong' },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-mid': 'mid' },
    policy: {
      failure: 'strong', 'first-turn': 'mid', verification: 'mid', implementation: 'mid',
      exploration: 'cheap', unclassified: 'cheap',
    },
    judge: { enabled: false },
    telemetry: { allowlistOnly: true, captureSnippets: false },
    ...(block === undefined ? {} : { effortScheduling: block as never }),
  })
  const log = path.join(mkdtempSync(path.join(os.tmpdir(), 'sabi-effort-')), 'decisions.jsonl')
  const sabi: SabiServer = createSabiServer({ config, logFile: log, verbose: false })
  const port = await sabi.listen(0, '127.0.0.1')
  return {
    port, log, bodies,
    close: async () => { await sabi.close(); mock.close() },
  }
}

async function send(port: number, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
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

const payload = (effort: string) => ({
  model: 'sabi-mid',
  stream: false,
  max_tokens: 16,
  reasoning_effort: effort,
  messages: ROUND,
})

test('observe records the schedule and forwards the client body key for key', async () => {
  const harness = await start(BLOCK)
  try {
    const sent = payload('medium')
    await send(harness.port, sent)
    const record = await waitForRecord(harness.log)
    assert.equal(harness.bodies.length, 1)
    // The one assertion that keeps observe from silently becoming override.
    assert.equal(harness.bodies[0].reasoning_effort, 'medium')
    assert.deepEqual(Object.keys(harness.bodies[0]).sort(), Object.keys(sent).sort())
    assert.equal(record.tier, 'mid')
    assert.equal(record.effortPercent, 47)
    assert.equal(record.effortIndex, 1)
    assert.equal(record.effortLevel, 'medium')
    assert.deepEqual(record.effortLadder, ['low', 'medium', 'high'])
    assert.equal(record.effortReason, 'kind:implementation')
    assert.equal(record.effortSource, 'client')
    assert.equal(record.effort, 'medium')
  } finally {
    await harness.close()
  }
})

test('override mode still forwards the client body unchanged in this build', async () => {
  const harness = await start({ ...BLOCK, mode: 'override' })
  try {
    const sent = payload('medium')
    await send(harness.port, sent)
    const record = await waitForRecord(harness.log)
    assert.equal(harness.bodies[0].reasoning_effort, 'medium')
    assert.deepEqual(Object.keys(harness.bodies[0]).sort(), Object.keys(sent).sort())
    assert.equal(record.effortPercent, 47)
    assert.equal(record.effortLevel, 'medium')
    assert.equal(record.effortSource, 'client')
  } finally {
    await harness.close()
  }
})

test('without the block, no effort field is written and the body is untouched', async () => {
  const harness = await start()
  try {
    const sent = payload('medium')
    await send(harness.port, sent)
    const record = await waitForRecord(harness.log)
    assert.deepEqual(Object.keys(harness.bodies[0]).sort(), Object.keys(sent).sort())
    assert.equal(record.effortPercent, undefined)
    assert.equal(record.effortIndex, undefined)
    assert.equal(record.effortLevel, undefined)
    assert.equal(record.effortLadder, undefined)
    assert.equal(record.effortReason, undefined)
    // The pre-existing observation is untouched by this feature.
    assert.equal(record.effort, 'medium')
    assert.equal(record.effortSource, 'client')
  } finally {
    await harness.close()
  }
})
