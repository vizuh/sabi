import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type DecisionRecord } from '@sabi/core'
import { createSabiServer, type SabiServer } from '../src/server.ts'

// Cline's documented "OpenAI Compatible" provider contract replayed against the
// Sabi proxy with two synthetic upstream lanes. The request shape — Base URL
// ending in /v1, POST {baseURL}/chat/completions, Authorization: Bearer, OpenAI
// Chat Completions body with model/messages/stream/tools/temperature, SSE
// streaming — is sourced from Cline's published provider docs and SDK reference
// (docs.cline.bot/provider-config/openai-compatible and the SDK provider
// reference, read 2026-09-21). This is protocol-level evidence only: the Cline
// extension itself was not executed here, and nothing in this file claims a
// live Cline run. Upstream model ids are synthetic fixtures, not live provider
// claims.

const CLINE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Execute a CLI command on the system',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The CLI command to execute' } },
        required: ['command'],
      },
    },
  },
]

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}

let cheapLane: Server
let midLane: Server
let cheapPort = 0
let midPort = 0
let cheapRequests: CapturedRequest[] = []
let midRequests: CapturedRequest[] = []

let sabi: SabiServer
let sabiPort = 0
let logFile = ''

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function startLane(capture: () => CapturedRequest[]): Server {
  return createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>
      const entry = { headers: { ...req.headers }, body }
      capture().push(entry)
      const model = String(body.model ?? 'synthetic')
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(sseFrame({ id: 'c1', model, choices: [{ index: 0, delta: { role: 'assistant' } }] }))
        res.write(sseFrame({ id: 'c1', model, choices: [{ index: 0, delta: { content: 'hi' } }] }))
        res.write(sseFrame({
          id: 'c1',
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        }))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'c1',
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }))
    })
  })
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port)
    })
  })
}

function readLog(): DecisionRecord[] {
  return readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}

async function waitForRows(count: number): Promise<DecisionRecord[]> {
  const deadline = Date.now() + 2000
  for (;;) {
    const rows = readLog()
    if (rows.length >= count) return rows
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} decisions`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Posts exactly the way Cline's OpenAI Compatible provider does. */
function clinePost(body: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${sabiPort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer cline-local-placeholder',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

before(async () => {
  cheapLane = startLane(() => cheapRequests)
  midLane = startLane(() => midRequests)
  cheapPort = await listen(cheapLane)
  midPort = await listen(midLane)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-cline-protocol-'))
  logFile = path.join(dir, 'decisions.jsonl')
  const config = validateConfig({
    upstreams: {
      'lane-cheap': { baseURL: `http://127.0.0.1:${cheapPort}/v1`, apiKey: false },
      'lane-mid': { baseURL: `http://127.0.0.1:${midPort}/v1`, apiKey: false },
    },
    models: {
      cheap: { upstream: 'lane-cheap', model: 'synthetic-cheap', cost: { input: 1, output: 2 } },
      mid: { upstream: 'lane-mid', model: 'synthetic-mid', cost: { input: 5, output: 10 } },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-cheap': 'cheap' },
    policy: { 'first-turn': 'mid', exploration: 'cheap', unclassified: 'cheap' },
    judge: { enabled: false },
  })
  sabi = createSabiServer({ config, logFile, verbose: false })
  sabiPort = await sabi.listen(0, '127.0.0.1')
})

after(async () => {
  await sabi.close()
  cheapLane.close()
  midLane.close()
})

test('a Cline-shaped fresh streaming chat round lands on the mid lane and stays Sabi-shaped', async () => {
  cheapRequests = []
  midRequests = []
  const response = await clinePost({
    model: 'sabi-code',
    stream: true,
    temperature: 0,
    tools: CLINE_TOOLS,
    messages: [
      { role: 'system', content: 'You are a precise coding agent.' },
      { role: 'user', content: 'Plan a change to the auth module.' },
    ],
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  const text = await response.text()
  assert.ok(text.includes('data: [DONE]'), 'the SSE stream must terminate with [DONE]')
  const frames = text.split('\n').filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]').map((line) => JSON.parse(line.slice(6)))
  assert.ok(frames.some((frame) => frame.usage?.total_tokens === 60), 'a usage-bearing frame must reach the client')
  for (const frame of frames) {
    if (frame.model !== undefined) assert.equal(frame.model, 'sabi-code', 'the client-visible model must stay the requested alias')
  }
  assert.equal(midRequests.length, 1, 'the first round must go to exactly one mid-lane request')
  assert.equal(cheapRequests.length, 0)
  assert.equal(midRequests[0]?.body.model, 'synthetic-mid')
  assert.ok(Array.isArray(midRequests[0]?.body.tools), 'the tool schema must pass through to the upstream')
  const rows = await waitForRows(1)
  assert.equal(rows[0]?.tier, 'mid')
  assert.equal(rows[0]?.upstreamModel, 'synthetic-mid')
})

test('a Cline-shaped exploration round after a tool result lands on the cheap lane', async () => {
  cheapRequests = []
  midRequests = []
  const response = await clinePost({
    model: 'sabi-code',
    stream: true,
    temperature: 0,
    tools: CLINE_TOOLS,
    messages: [
      { role: 'system', content: 'You are a precise coding agent.' },
      { role: 'user', content: 'Plan a change to the auth module.' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'execute_command', arguments: '{"command":"grep -r auth src/"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'src/auth.ts:1:export function login()' },
    ],
  })
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.ok(text.includes('data: [DONE]'))
  assert.equal(cheapRequests.length, 1, 'the exploration round must go to exactly one cheap-lane request')
  assert.equal(midRequests.length, 0)
  assert.equal(cheapRequests[0]?.body.model, 'synthetic-cheap')
  const rows = await waitForRows(2)
  assert.equal(rows[1]?.tier, 'cheap')
  assert.equal(rows[1]?.upstreamModel, 'synthetic-cheap')
})

test('a Cline-shaped non-streaming round on a fixed alias stays on its lane', async () => {
  cheapRequests = []
  midRequests = []
  const response = await clinePost({
    model: 'sabi-cheap',
    stream: false,
    messages: [
      { role: 'system', content: 'You are a precise coding agent.' },
      { role: 'user', content: 'What is 2 + 2?' },
    ],
  })
  assert.equal(response.status, 200)
  const payload = await response.json() as { model: string; choices: Array<{ message: { content: string } }> }
  assert.equal(payload.model, 'sabi-cheap')
  assert.equal(payload.choices[0]?.message.content, 'ok')
  assert.equal(cheapRequests.length, 1)
  assert.equal(cheapRequests[0]?.body.model, 'synthetic-cheap')
})
