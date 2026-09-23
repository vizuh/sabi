import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMeasuredContext, classifyRound, extractTrajectoryState, measuredContextTokens, normalizeAlias } from '../src/index.ts'
import type { ChatMessage } from '../src/types.ts'

function body(messages: ChatMessage[], tools?: Array<{ function?: { name?: string; parameters?: Record<string, unknown> } }>) {
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

test('an RTK-rewritten command is classified by what it does, not by the wrapper', () => {
  const kind = (command: string): string =>
    classifyRound([{ name: 'shell_command', args: JSON.stringify({ command }) }])
  assert.equal(kind('rtk cargo test'), 'verification')
  assert.equal(kind('rtk err npm run build'), 'verification')
  assert.equal(kind('rtk test cargo test'), 'verification')
  assert.equal(kind('rtk git status'), 'exploration')
  assert.equal(kind('rtk read src/a.ts'), 'exploration')
  assert.equal(kind('rtk grep pattern .'), 'exploration')
  assert.equal(kind('rtk gain --daily'), 'exploration')
  // A wrapper with no inner command is still its own verb, and a non-RTK command is untouched.
  assert.equal(kind('rtk test'), 'verification')
  assert.equal(kind('echo rtk'), 'unclassified')
  assert.equal(kind('cargo test'), 'verification')
  assert.equal(kind('cat src/a.ts'), 'exploration')
})

test('tool schemas are part of the context estimate, never of measured context', () => {
  const withTools = extractTrajectoryState(
    body(
      [system, { role: 'user', content: 'hello' }],
      [{ function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
    ),
  )
  const withoutTools = extractTrajectoryState(body([system, { role: 'user', content: 'hello' }]))
  assert.ok(withTools.contextChars > withoutTools.contextChars, 'schema text is context the provider charges for')
  assert.equal(withTools.contextTokens, undefined)
  assert.equal(withTools.contextKnown, false)
})

test('a billed total floors the estimate and marks the context measured', () => {
  const state = extractTrajectoryState(body([system, { role: 'user', content: 'hello' }]))
  applyMeasuredContext(state, { measuredContextTokens: 120_000, contextGeneration: 2 })
  assert.equal(state.contextKnown, true)
  assert.equal(state.contextTokens, 120_000)
  assert.equal(state.contextGeneration, 2)

  // The character estimate is a floor too: a smaller billed value never lowers it.
  const bigger = extractTrajectoryState(body([system, { role: 'user', content: 'x'.repeat(40_000) }]))
  applyMeasuredContext(bigger, { measuredContextTokens: 10 })
  assert.equal(bigger.contextTokens, bigger.estimatedTokens)

  // Nothing observed still means unknown.
  const unknown = extractTrajectoryState(body([system, { role: 'user', content: 'hello' }]))
  applyMeasuredContext(unknown, {})
  assert.equal(unknown.contextTokens, undefined)
  assert.equal(unknown.contextKnown, false)
})

test('measured context tokens come from billed usage only, and unknown usage stays unknown', () => {
  assert.equal(measuredContextTokens({ promptTokens: 100, completionTokens: 20 }), 120)
  assert.equal(measuredContextTokens({ promptTokens: 1, completionTokens: 2, totalTokens: 500 }), 500)
  assert.equal(measuredContextTokens({ promptTokens: 0, completionTokens: 0 }), undefined)
  assert.equal(measuredContextTokens({ promptTokens: Number.NaN, completionTokens: 2 }), undefined)
  assert.equal(measuredContextTokens(undefined), undefined)
})

test('a dropped connection is transport, not a task failure', () => {
  // The wording a client prints after Sabi's own transport deadline ends a stream. Before this it
  // carried no transport evidence, so the next round read as a task failure and escalated straight
  // back to the tier that had just timed out — ten consecutive 120s rounds in one real session.
  const drops = [
    'Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
    'Error: socket hang up',
    'Error: read ECONNRESET',
    '{"error":{"message":"other side closed","type":"sabi_error","code":504}}',
    'fetch failed: connection reset by peer',
  ]
  for (const content of drops) {
    const state = extractTrajectoryState(
      body([system, { role: 'user', content: 'continue' }, { role: 'tool', content }]),
    )
    assert.equal(state.failure, 'transport', content)
    assert.ok(state.failureEvidence.length > 0, content)
  }

  // The deliberate trade-off of ranking named conditions above the hard patterns: a blob reporting
  // both a task failure and a dropped connection reads as transport, exactly like one reporting a
  // failure and a session limit. That can miss an escalation in a rare mixed case; the alternative
  // was a loop that re-escalated to the tier that had just timed out.
  const mixed = extractTrajectoryState(
    body([system, { role: 'tool', content: 'AssertionError: expected 2 to equal 3\nError: read ECONNRESET' }]),
  )
  assert.equal(mixed.failure, 'transport')

  // A task failure with no transport wording in it is still hard.
  const plainFailure = extractTrajectoryState(
    body([system, { role: 'tool', content: 'AssertionError: expected 2 to equal 3\n    at Test.<anonymous> (test.mjs:12:9)' }]),
  )
  assert.equal(plainFailure.failure, 'hard')
})

test('provider and subscription limits are transport, not task failures', () => {
  // The exact phrasings a harness emits when a plan runs out; before this, three of them carried
  // no evidence at all and the round fell to `unclassified` — the rule the proxy consults Jev on.
  const limits = [
    "You've hit your session limit · resets 8:30pm (Europe/Lisbon)",
    'Usage limit reached · continuing automatically at 8:30pm · esc or type to cancel',
    '⚠ /low-priority to continue now at lower priority · uses your weekly limit',
    "Agent terminated early due to an API error: You've hit your session limit · resets 8:30pm (error type rate_limit, HTTP 429)",
    'Error: rate_limit_error',
    'insufficient_quota',
  ]
  for (const content of limits) {
    const state = extractTrajectoryState(
      body([system, { role: 'user', content: 'continue' }, { role: 'tool', content }]),
    )
    assert.equal(state.failure, 'transport', content)
    assert.ok(state.failureEvidence.length > 0, content)
  }
})

test('a named limit outranks an error-looking line; a bare status code does not outrank a failing test', () => {
  // "Error:" plus a named limit is still the provider talking, not the task.
  const limited = extractTrajectoryState(
    body([system, { role: 'user', content: 'continue' }, { role: 'tool', content: "Error: You've hit your session limit" }]),
  )
  assert.equal(limited.failure, 'transport')

  // A genuinely failing test that happens to print 429 stays a task failure, with or without words.
  const failedTest = extractTrajectoryState(
    body([
      system,
      { role: 'user', content: 'run the tests' },
      { role: 'assistant', tool_calls: [{ function: { name: 'shell_command', arguments: '{"command":"npm test"}' } }] },
      { role: 'tool', content: 'Tests: 1 failed, 0 passed\nexpected 200, got 429\nexit code: 1' },
    ]),
  )
  assert.equal(failedTest.failure, 'hard')
})
