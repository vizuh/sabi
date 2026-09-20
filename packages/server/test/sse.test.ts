import test from 'node:test'
import assert from 'node:assert/strict'
import { createSseTap, type SseTapResult } from '../src/sse.ts'

const encoder = new TextEncoder()
const chunks = [
  { model: 'mock-cheap', choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id: 'id-one', type: 'function', function: { name: 'mcp__ReadFile', arguments: '{"path":"' } },
    { index: 1, id: 'id-two', type: 'function', function: { name: 'exec_command', arguments: '{"command":"' } },
  ] } }] },
  { model: 'mock-cheap', choices: [{ index: 0, delta: { tool_calls: [
    { index: 1, function: { arguments: 'echo café 🙂"}' } },
    { index: 0, function: { arguments: 'src/a.ts"}' } },
  ], reasoning_content: 'unchanged protocol content' } }] },
  { model: 'mock-cheap', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  { model: 'mock-cheap', choices: [], usage: { prompt_tokens: 23, completion_tokens: 4, total_tokens: 27 } },
]

test('one-byte UTF-8 fragments preserve parallel argument deltas, metadata, final usage and DONE', () => {
  let result: SseTapResult | undefined
  let calls = 0
  const tap = createSseTap('sabi-code', (value) => { result = value; calls += 1 })
  const wire = ': keep-alive\r\n\r\n' + chunks.map((chunk, i) =>
    `id: ${i}\r\nevent: message\r\ndata: ${JSON.stringify(chunk)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
  const bytes = encoder.encode(wire)
  const output = [...bytes].map((byte) => tap.push(Uint8Array.of(byte)))
  output.push(tap.flush(), tap.flush())
  const text = new TextDecoder().decode(Buffer.concat(output))
  assert.match(text, /: keep-alive/)
  assert.match(text, /id: 0\r\nevent: message/)
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
  const observed = text.split(/\r?\n/).filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)))
  assert.deepEqual(observed, chunks.map((chunk) => ({ ...chunk, model: 'sabi-code' })))
  assert.equal(result?.model, 'mock-cheap')
  assert.deepEqual(result?.usage, { promptTokens: 23, completionTokens: 4, cachedTokens: 0, totalTokens: 27 })
  assert.equal(calls, 1)
  assert.equal(tap.done, true)
})

test('multi-line SSE data is parsed as a single event', () => {
  const tap = createSseTap('sabi-code', () => {})
  const output = tap.push(encoder.encode('data: {"model":"upstream",\ndata: "choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
  tap.flush()
  assert.match(new TextDecoder().decode(output), /"model":"sabi-code"/)
})

test('a provider error inside a 200 stream carries its own message out', () => {
  const tap = createSseTap('sabi-code', () => {})
  tap.push(encoder.encode('data: {"model":"mock-cheap","choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n'))
  assert.throws(
    () => tap.push(encoder.encode('data: {"error":{"message":"This request requires more credits","code":402}}\n\n')),
    /upstream stream error: This request requires more credits/,
  )

  // A string error, and one with no usable message, still fail — with a truthful text either way.
  const second = createSseTap('sabi-code', () => {})
  assert.throws(() => second.push(encoder.encode('data: {"error":"context length exceeded"}\n\n')), /context length exceeded/)
  const third = createSseTap('sabi-code', () => {})
  assert.throws(() => third.push(encoder.encode('data: {"error":{}}\n\n')), /without a message/)
})

test('malformed and truncated streams fail without a successful finish callback', () => {
  for (const wire of ['data: nope\n\n', 'data: null\n\n', 'data: []\n\n', 'data: {"error":"bad"}\n\n',
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']) {
    let calls = 0
    const tap = createSseTap('sabi-code', () => { calls += 1 })
    assert.throws(() => { tap.push(encoder.encode(wire)); tap.flush() }, /upstream/)
    assert.equal(calls, 0)
  }
})

test('empty or malformed usage stays unknown after a terminal choice', () => {
  const terminal = { model: 'mock-cheap', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
  for (const usage of [{}, { prompt_tokens: 1 }, { prompt_tokens: -1, completion_tokens: 2 }]) {
    let result: SseTapResult | undefined
    const tap = createSseTap('sabi-code', (value) => { result = value })
    tap.push(encoder.encode(`data: ${JSON.stringify(terminal)}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`))
    tap.flush()
    assert.equal(result?.usage, undefined)
  }
})

test('usage-only and unfinished streams reject before forwarding DONE', () => {
  const usageOnly = { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }
  const unfinished = { choices: [{ index: 0, delta: {
    tool_calls: [{ index: 0, function: { arguments: '{\"path\":\"' } }],
  } }] }
  for (const event of [usageOnly, unfinished]) {
    const wire = `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`
    let calls = 0
    const tap = createSseTap('sabi-code', () => { calls += 1 })
    assert.throws(() => tap.push(encoder.encode(wire)), /terminal choice/)
    assert.equal(calls, 0)
  }
})

test('a usage chunk restating the terminal choice is an idempotent echo, not corruption', () => {
  // Observed live 2026-09-20: OpenAI-via-OpenRouter repeats finish_reason "stop" with an empty
  // delta on its final usage-bearing chunk. The tap must accept that echo and still record usage.
  const events = [
    { model: 'upstream-mid', choices: [{ index: 0, delta: { content: 'ok', role: 'assistant' }, finish_reason: null }] },
    { model: 'upstream-mid', choices: [{ index: 0, delta: { content: '', role: 'assistant' }, finish_reason: 'stop' }] },
    { model: 'upstream-mid', choices: [{ index: 0, delta: { content: '', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } },
  ]
  const wire = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  let result: SseTapResult | undefined
  let calls = 0
  const tap = createSseTap('sabi-code', (value) => { result = value; calls += 1 })
  tap.push(encoder.encode(wire))
  tap.flush()
  assert.equal(calls, 1)
  assert.equal(result?.finishReason, 'stop')
  assert.equal(result?.usage?.totalTokens, 45)
  assert.equal(tap.done, true)
})

test('post-terminal choice deltas reject before DONE', () => {
  const events = [
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [{ index: 0, delta: {
      tool_calls: [{ index: 0, function: { arguments: '{\"late\":true}' } }],
    } }] },
  ]
  const wire = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  let calls = 0
  const tap = createSseTap('sabi-code', () => { calls += 1 })
  assert.throws(() => tap.push(encoder.encode(wire)), /continued after terminal/)
  assert.equal(calls, 0)
})
