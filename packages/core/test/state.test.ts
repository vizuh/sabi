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
  assert.ok(state.failureEvidence.some((line) => line.includes('permission denial')))
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
