import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseCreatedRunResult,
  parseCreatedTerminalResult,
  parseStartedWorkerResult,
  parseTerminalReadReceipt,
  parseTerminalSendReceipt,
  parseTerminalWaitReceipt,
  parseWorkerStatusResult,
  queryOrcaTerminals,
  queryOrcaWorktrees,
  runOrca,
} from '../src/orca.ts'

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
function fixture(name: string): string {
  const full = path.join(fixturesDir, name)
  chmodSync(full, 0o755) // belt-and-suspenders — git preserves the executable bit, but don't rely on it silently
  return full
}

test('a well-formed envelope (ok:true, result.worktrees array) -> ok true', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-ok.js') })
  assert.equal(result.ok, true)
  assert.deepEqual(result.worktrees, [{ path: '/tmp/example', branch: 'main' }])
})

test('a missing binary -> binary-not-found, never throws', () => {
  const result = runOrca(['--json'], { bin: '/nonexistent/sabi-test-orca-binary' })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'binary-not-found')
})

test('malformed JSON stdout -> invalid-json', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-bad-json.js') })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid-json')
})

test('valid JSON missing the result envelope -> unrecognized-shape, distinct from a real "no match"', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-not-array.js') })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'unrecognized-shape')
})

test('a bare JSON array (the old, disproven assumption) -> unrecognized-shape, not silently accepted', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-bare-array.js') })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'unrecognized-shape')
})

test('a real orca-ide error envelope (ok:false) -> unrecognized-shape, not treated as a success with no data', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-envelope-error.js') })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'unrecognized-shape')
})

test('a non-zero exit code -> nonzero-exit', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-nonzero.js') })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'nonzero-exit')
})

test('a call that exceeds the timeout -> timeout, not a hang', () => {
  const result = runOrca(['--json'], { bin: fixture('orca-slow.js'), timeoutMs: 200 })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'timeout')
})

test('queryOrcaWorktrees populates the worktrees field', () => {
  const result = queryOrcaWorktrees({ bin: fixture('orca-ok.js') })
  assert.equal(result.ok, true)
  assert.deepEqual(result.worktrees, [{ path: '/tmp/example', branch: 'main' }])
  assert.equal(result.terminals, undefined)
})

test('queryOrcaTerminals populates the terminals field, not worktrees', () => {
  const result = queryOrcaTerminals({ bin: fixture('orca-ok.js') })
  assert.equal(result.ok, true)
  assert.deepEqual(result.terminals, [{ worktreePath: '/tmp/example', branch: 'main' }])
  assert.equal(result.worktrees, undefined)
})

test('typed Orca receipts accept only explicit known result shapes', () => {
  assert.deepEqual(parseTerminalSendReceipt({ requestId: 'req-1', inputAccepted: true, turnStarted: true }), {
    requestId: 'req-1', inputAccepted: true, turnStarted: true,
  })
  assert.deepEqual(parseTerminalWaitReceipt({ wait: { satisfied: true, status: 'running' } }), {
    satisfied: true, status: 'running',
  })
  assert.deepEqual(parseTerminalReadReceipt({ terminal: { handle: 'term-1', tail: ['done'] }, latestCursor: '4' }), {
    terminal: { handle: 'term-1', tail: ['done'] }, latestCursor: '4',
  })
  assert.deepEqual(parseCreatedTerminalResult({ terminal: { handle: 'term-2' } }), { handle: 'term-2' })
  assert.deepEqual(parseCreatedRunResult({ run_id: 'run-1' }), { runId: 'run-1' })
  assert.deepEqual(parseStartedWorkerResult({ dispatch_id: 'dispatch-1' }), { dispatchId: 'dispatch-1' })
  assert.deepEqual(parseWorkerStatusResult({ worker: { state: 'completed' } }), { status: 'completed' })
  assert.equal(parseTerminalSendReceipt({ nested: { inputAccepted: true } }), undefined)
  assert.equal(parseTerminalWaitReceipt({ status: 'running' }), undefined)
  assert.equal(parseTerminalReadReceipt({ output: ['done'] }), undefined)
})
