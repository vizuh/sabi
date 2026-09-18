import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTrajectoryState, normalizeAlias } from '../src/index.ts'
import type { ChatMessage } from '../src/types.ts'

function body(messages: ChatMessage[], tools?: Array<{ function?: { name?: string } }>) {
  return { model: 'sabi-code', messages, tools }
}

const system: ChatMessage = { role: 'system', content: 'you are a coding agent' }

test('first turn with no assistant messages is classified as first-turn', () => {
  const state = extractTrajectoryState(body([system, { role: 'user', content: 'fix the bug' }]))
  assert.equal(state.roundKind, 'first-turn')
  assert.equal(state.failure, 'none')
  assert.equal(state.assistantTurns, 0)
})

test('new user instruction mid-session is classified as first-turn', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'task one' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'now do task two' },
    ]),
  )
  assert.equal(state.roundKind, 'first-turn')
})

test('read/search tool results are exploration', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'find the auth code' },
      { role: 'assistant', tool_calls: [{ function: { name: 'grep', arguments: '{"pattern":"auth"}' } }] },
      { role: 'tool', content: '3 matches in 2 files' },
    ]),
  )
  assert.equal(state.roundKind, 'exploration')
  assert.deepEqual(state.lastToolNames, ['grep'])
})

test('edit tool results are implementation', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'fix it' },
      { role: 'assistant', tool_calls: [{ function: { name: 'edit_file', arguments: '{}' } }] },
      { role: 'tool', content: 'file updated' },
    ]),
  )
  assert.equal(state.roundKind, 'implementation')
})

test('test-run tool results are verification and failing output escalates', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'run the tests' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 2 failed, 10 passed\nexit code: 1' },
    ]),
  )
  assert.equal(state.roundKind, 'verification')
  assert.equal(state.failure, 'hard')
  assert.ok(state.failureEvidence.length > 0)
  assert.ok(state.failureEvidence.every((line) => !line.includes('Tests:')))
})

test('passing test output does not register a failure', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'run the tests' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 0 failed, 12 passed\nexit code: 0' },
    ]),
  )
  assert.equal(state.failure, 'none')
})

test('harness permission denials are not treated as failures', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'write the file' },
      { role: 'assistant', tool_calls: [{ function: { name: 'write_file', arguments: '{}' } }] },
      { role: 'tool', content: 'Permission denied: user denied the request' },
    ]),
  )
  assert.equal(state.failure, 'none')
  assert.ok(state.failureEvidence.some((line) => line === 'permission-denial'))
})

test('unknown shell command stays unclassified', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'go' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"docker ps"}' } }] },
      { role: 'tool', content: 'ok' },
    ]),
  )
  assert.equal(state.roundKind, 'unclassified')
})

test('a rate limit in tool output is transport, not a hard failure', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'continue' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"curl api"}' } }] },
      { role: 'tool', content: 'HTTP 429 too many requests: rate limit exceeded' },
    ]),
  )
  assert.equal(state.failure, 'transport')
  assert.ok(state.failureEvidence.some((code) => code === 'rate-limited'))
})

test('trajectory metrics are counted', () => {
  const state = extractTrajectoryState(
    body(
      [
        system,
        { role: 'user', content: 'hello' },
        { role: 'assistant', tool_calls: [{ function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', content: 'file body' },
      ],
      [{ function: { name: 'read_file' } }, { function: { name: 'grep' } }],
    ),
  )
  assert.equal(state.messageCount, 4)
  assert.equal(state.toolMessages, 1)
  assert.equal(state.hasTools, true)
  assert.ok(state.estimatedTokens > 0)
})

test('alias normalization strips provider prefixes', () => {
  assert.equal(normalizeAlias('sabi/sabi-code'), 'sabi-code')
  assert.equal(normalizeAlias('sabi-code'), 'sabi-code')
  assert.equal(normalizeAlias(undefined), '')
})

test('an image part is reported as a modality and charged without inflating text chars', () => {
  const image = { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(4000)}` } }
  const withImage = extractTrajectoryState(
    body([system, { role: 'user', content: [{ type: 'text', text: 'inspect' }, image] }]),
  )
  assert.deepEqual(withImage.inputModalities, ['text', 'image'])
  assert.deepEqual(withImage.mediaCounts, { image: 1 })
  // The base64 payload is not text: four thousand payload chars must not become characters, but
  // the round still owes the per-image token bound.
  assert.ok(withImage.contextChars < 100, `payload counted as text (${withImage.contextChars} chars)`)
  assert.equal(withImage.estimatedTokens - Math.ceil(withImage.contextChars / 3.6), 1500)
})

test('media inside a tool result counts too, and other media are charged by payload', () => {
  const state = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'look at this' },
      { role: 'tool', content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/crop.png' } }] },
      { role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'Zml4dHVyZQ==', format: 'wav' } }] },
    ]),
  )
  assert.deepEqual(state.inputModalities, ['text', 'audio', 'image'])
  assert.deepEqual(state.mediaCounts, { image: 1, audio: 1 })
  assert.ok(state.estimatedTokens > Math.ceil(state.contextChars / 3.6), 'media must add tokens')
})

test('a request with no media states text as its only modality', () => {
  const state = extractTrajectoryState(body([system, { role: 'user', content: 'plain question' }]))
  assert.deepEqual(state.inputModalities, ['text'])
  assert.equal(state.mediaCounts, undefined)
})
