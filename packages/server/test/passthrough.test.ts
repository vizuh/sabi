import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, type SabiConfig } from '@sabi/core'
import { createSabiServer, type SabiServerOptions } from '../src/server.ts'

interface Seen { path: string; body: Record<string, unknown>; headers: IncomingHttpHeaders }
type Responder = (seen: Seen, res: ServerResponse) => void | Promise<void>

/** A value that must never appear anywhere Sabi writes: logs, records, responses or errors. */
const SENTINEL = 'sk-ant-borrowed-sentinel-000000000000'

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolve(typeof address === 'object' && address ? address.port : 0)
  }))
}

function anthropicReply(res: ServerResponse, model: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }] }))
}

async function fixture(
  t: TestContext,
  respond: Responder = (seen, res) => anthropicReply(res, seen.body.model),
  options: Partial<SabiServerOptions> = {},
  mutate?: (config: SabiConfig) => void,
) {
  const seen: Seen[] = []
  const mock = createServer((req, res) => {
    let raw = ''
    req.on('data', (data) => { raw += data })
    req.on('end', () => {
      const item = { path: req.url ?? '', body: JSON.parse(raw) as Record<string, unknown>, headers: req.headers }
      seen.push(item)
      Promise.resolve(respond(item, res)).catch(() => res.destroy())
    })
  })
  const port = await listen(mock)
  const config = validateConfig({
    upstreams: {
      // A borrowed upstream holds no credential of its own: `auth: passthrough` forbids one.
      borrowed: { baseURL: `http://127.0.0.1:${port}`, auth: 'passthrough' },
      keyed: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: false },
    },
    models: {
      cheap: { upstream: 'borrowed', model: 'mock-anthropic-cheap' },
      mid: { upstream: 'borrowed', model: 'mock-anthropic-mid' },
      strong: { upstream: 'borrowed', model: 'mock-anthropic-strong' },
      keyed: { upstream: 'keyed', model: 'mock-keyed' },
    },
    aliases: { 'sabi-code': 'auto', 'sabi-fixed': 'keyed' },
    policy: { failure: 'strong', 'first-turn': 'cheap', unclassified: 'cheap', exploration: 'cheap', verification: 'mid', implementation: 'mid' },
  })
  mutate?.(config)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-borrowed-'))
  const logFile = path.join(dir, 'decisions.jsonl')
  const sabi = createSabiServer({ config, logFile, verbose: false, ...options })
  const sabiPort = await sabi.listen(0, '127.0.0.1')
  t.after(async () => {
    sabi.server.closeAllConnections()
    mock.closeAllConnections()
    await Promise.all([sabi.close(), new Promise<void>((resolve) => mock.close(() => resolve()))])
    rmSync(dir, { recursive: true, force: true })
  })
  const post = (
    format: 'messages' | 'responses',
    body: Record<string, unknown>,
    headers: Record<string, string> = { 'x-api-key': SENTINEL },
  ) => fetch(`http://127.0.0.1:${sabiPort}/v1/${format}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { sabi, seen, post, logFile, dir, baseUrl: `http://127.0.0.1:${sabiPort}` }
}

const anthropicBody = (extra: Record<string, unknown> = {}) => ({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  system: 'you are a coding agent',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'read the file' }] }],
  tools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object' } }],
  ...extra,
})

const responsesBody = (extra: Record<string, unknown> = {}) => ({
  model: 'gpt-6-luna',
  instructions: 'you are a coding agent',
  input: [{ role: 'user', content: 'read the file' }],
  max_output_tokens: 4096,
  ...extra,
})

test('a borrowed round is forwarded with only the model rewritten', async (t) => {
  const { seen, post, sabi } = await fixture(t)
  const sent = anthropicBody()
  const response = await post('messages', sent)
  assert.equal(response.status, 200)
  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.path, '/v1/messages', 'the provider protocol path, not the OpenAI path')
  // The tier's model replaces the harness's own label; everything else is the harness's own body.
  assert.equal(seen[0]?.body.model, 'mock-anthropic-cheap')
  assert.deepEqual({ ...seen[0]?.body, model: sent.model }, sent)
  assert.equal(sabi.recent.length, 1)
  assert.equal(sabi.recent[0]?.upstreamModel, 'mock-anthropic-cheap')
  assert.equal(sabi.recent[0]?.tier, 'cheap')
})

test('a Responses round is forwarded on the Responses path with the tier model', async (t) => {
  const { seen, post } = await fixture(t, (seen, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'resp_1', object: 'response', model: seen.body.model, output: [] }))
  })
  const sent = responsesBody()
  const response = await post('responses', sent, { authorization: `Bearer ${SENTINEL}` })
  assert.equal(response.status, 200)
  assert.equal(seen[0]?.path, '/responses')
  assert.equal(seen[0]?.body.model, 'mock-anthropic-cheap')
  assert.deepEqual({ ...seen[0]?.body, model: sent.model }, sent)
})

test('the harness credential reaches the upstream and is written nowhere', async (t) => {
  const { seen, post, logFile, sabi, dir } = await fixture(t)
  await post('messages', anthropicBody(), { 'x-api-key': SENTINEL, 'anthropic-version': '2023-06-01' })
  assert.equal(seen[0]?.headers['x-api-key'], SENTINEL, 'the credential is forwarded unchanged')
  assert.equal(seen[0]?.headers['anthropic-version'], '2023-06-01', 'provider protocol headers are forwarded')

  // The credential is borrowed, so Sabi must not keep it: not in the decision log, not in the
  // in-memory record, not in the forwarded body, and not in any file under its state directory.
  assert.equal(readFileSync(logFile, 'utf8').includes(SENTINEL), false, 'the decision log carries no credential')
  assert.equal(JSON.stringify(sabi.recent).includes(SENTINEL), false, 'the record carries no credential')
  assert.equal(JSON.stringify(seen.map((item) => item.body)).includes(SENTINEL), false, 'the credential is not in a body')
  const walk = (dirPath: string): string[] => readdirSync(dirPath).flatMap((entry) => {
    const full = path.join(dirPath, entry)
    return statSync(full).isDirectory() ? walk(full) : [readFileSync(full, 'utf8')]
  })
  assert.equal(walk(dir).some((text) => text.includes(SENTINEL)), false, 'no file under the state directory holds it')
})

test('a decoy credential file on disk is never used', async (t) => {
  // If Sabi read a harness credential store instead of forwarding the request's own credential, the
  // decoy token would be the one the provider sees. It must not be.
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'sabi-fakehome-'))
  mkdirSync(path.join(fakeHome, '.claude'), { recursive: true })
  const decoy = 'sk-ant-DECOY-from-a-credentials-file'
  writeFileSync(path.join(fakeHome, '.claude', 'credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: decoy } }))
  t.after(() => rmSync(fakeHome, { recursive: true, force: true }))

  const { seen, post } = await fixture(t)
  await post('messages', anthropicBody(), { 'x-api-key': SENTINEL })
  assert.equal(seen[0]?.headers['x-api-key'], SENTINEL)
  assert.equal(JSON.stringify(seen[0]?.headers).includes(decoy), false, 'no credential from a file reached the provider')
})

test('streaming is forwarded frame by frame', async (t) => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"mock-anthropic-cheap"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]
  const { post } = await fixture(t, (_seen, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const frame of frames) res.write(frame)
    res.end()
  })
  const response = await post('messages', anthropicBody({ stream: true }))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), frames.join(''), 'frames arrive verbatim, not re-framed')
})

test('a borrowed round refuses without a credential', async (t) => {
  const { post, seen } = await fixture(t)
  const response = await post('messages', anthropicBody(), {})
  assert.equal(response.status, 401)
  assert.match(JSON.stringify(await response.json()), /no credential on the request/)
  assert.equal(seen.length, 0, 'nothing was dispatched')
})

test('a tier whose upstream holds its own key cannot serve a borrowed round', async (t) => {
  // The borrowed route exists for credentials Sabi does not have. Falling back to a configured key
  // would be a different decision than the operator configured, so it refuses instead.
  const { post, seen } = await fixture(t, undefined, {}, (config) => {
    config.models.cheap = { upstream: 'keyed', model: 'mock-keyed' }
  })
  const response = await post('messages', anthropicBody())
  assert.equal(response.status, 400)
  assert.match(JSON.stringify(await response.json()), /does not borrow authentication/)
  assert.equal(seen.length, 0)
})

test('passthrough.models isolates the borrowed round from the shared tiers', async (t) => {
  const { seen, post, sabi } = await fixture(t, undefined, {}, (config) => {
    // The shared 'cheap' tier is repointed at a non-passthrough upstream — the same setup that
    // makes the previous test refuse — proving what serves this round is the isolated
    // passthrough tier set, not an accidental fallback to the shared one.
    config.models.cheap = { upstream: 'keyed', model: 'mock-keyed' }
    config.passthrough = {
      models: { cheap: { upstream: 'borrowed', model: 'mock-anthropic-isolated' } },
      policy: { unclassified: 'cheap' },
    }
  })
  const response = await post('messages', anthropicBody())
  assert.equal(response.status, 200)
  assert.equal(seen[0]?.body.model, 'mock-anthropic-isolated')
  assert.equal(sabi.recent[0]?.upstreamModel, 'mock-anthropic-isolated')
  assert.equal(sabi.recent[0]?.tier, 'cheap')
})

test('the OpenAI-compatible route is unchanged by the borrowed routes', async (t) => {
  // The OpenAI route expects a chat completion, so this fixture's upstream replies in that shape.
  const { seen, baseUrl } = await fixture(t, (seen, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      model: seen.body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    }))
  })
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sabi-code', messages: [{ role: 'user', content: 'hello' }] }),
  })
  assert.equal(response.status, 200)
  assert.match(seen[0]?.path ?? '', /\/chat\/completions$/, 'the OpenAI route still posts chat/completions')
})

test('the borrowed route honours the request deadline', async (t) => {
  const { post } = await fixture(t, () => {
    // Never responds: the deadline must end the round rather than hang the harness forever.
  }, { requestTimeoutMs: 150 })
  const response = await post('messages', anthropicBody())
  assert.equal(response.status, 504)
})

test('an Anthropic tool result reaches the classifier, so the round can escalate on it', async (t) => {
  // The whole point of sitting between the harness and the model is routing on what the round
  // produced. Anthropic carries that evidence in `tool_result` blocks, not in `text` blocks, so a
  // view that only reads `text` would route every Claude Code round on prompts alone.
  const { post, sabi, seen } = await fixture(t)
  const failing = anthropicBody({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'run the tests' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'npm test' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'AssertionError: expected 2 to equal 3\n    at Test.<anonymous> (test.mjs:12:9)' }] },
    ],
  })
  const response = await post('messages', failing)
  assert.equal(response.status, 200)
  assert.equal(sabi.recent[0]?.state.failure, 'hard', 'the failing tool result is visible to the classifier')
  assert.equal(sabi.recent[0]?.tier, 'strong', 'a failing round escalates')
  assert.equal(seen[0]?.body.model, 'mock-anthropic-strong')
})
