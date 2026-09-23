import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExecutionReceipt,
  fingerprintValue,
  isExecutionReceiptSource,
  isExecutionReceiptStatus,
  sanitizeChangedFiles,
} from '../src/receipts.ts'

test('an exit-0 verifier run builds a passed receipt with identity and scope', () => {
  const receipt = buildExecutionReceipt({
    operationId: 'op-1',
    source: 'test',
    exitCode: 0,
    verifier: 'pytest',
    startedAt: 1000,
    durationMs: 250,
    expectedScope: 20,
    observedScope: 20,
  })
  assert.equal(receipt.status, 'passed')
  assert.equal(receipt.verifier, 'pytest')
  assert.equal(receipt.exitCode, 0)
  assert.equal(receipt.durationMs, 250)
  assert.equal(receipt.scopeMismatch, false)
})

test('a nonzero exit builds a failed receipt', () => {
  const receipt = buildExecutionReceipt({ operationId: 'op-2', source: 'build', exitCode: 1 })
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.exitCode, 1)
})

test('a missing exit code becomes unknown, never an invented verdict', () => {
  const receipt = buildExecutionReceipt({ operationId: 'op-3', source: 'edit' })
  assert.equal(receipt.status, 'unknown')
  assert.equal(receipt.exitCode, undefined)
})

test('an explicit valid status wins over the exit-code derivation', () => {
  const receipt = buildExecutionReceipt({ operationId: 'op-4', source: 'lint', status: 'failed', exitCode: 0 })
  assert.equal(receipt.status, 'failed')
})

test('an invalid explicit status falls back to exit-code derivation', () => {
  const receipt = buildExecutionReceipt({ operationId: 'op-5', source: 'lint', status: 'passed-ish', exitCode: 2 })
  assert.equal(receipt.status, 'failed')
})

test('a passing run on the wrong target keeps passed but flags scope mismatch', () => {
  const receipt = buildExecutionReceipt({
    operationId: 'op-6',
    source: 'test',
    exitCode: 0,
    expectedScope: 20,
    observedScope: 13,
  })
  assert.equal(receipt.status, 'passed')
  assert.equal(receipt.scopeMismatch, true)
})

test('scope mismatch is absent when either count is unknown', () => {
  const receipt = buildExecutionReceipt({ operationId: 'op-7', source: 'test', exitCode: 0, observedScope: 13 })
  assert.equal(receipt.scopeMismatch, undefined)
})

test('changed files keep names only, deduped, bounded, without raw contents', () => {
  const receipt = buildExecutionReceipt({
    operationId: 'op-8',
    source: 'edit',
    exitCode: 0,
    changedFiles: ['/abs/path/a.ts', 'a.ts', 'sub/b.ts', '', 42, 'c.ts'],
  })
  assert.deepEqual(receipt.changedFiles, ['a.ts', 'b.ts', 'c.ts'])
})

test('raw input/output text is fingerprinted, never stored', () => {
  const secret = 'SOME-RAW-TOOL-OUTPUT'
  const receipt = buildExecutionReceipt({ operationId: 'op-9', source: 'sandbox', inputText: 'cmd', outputText: secret })
  assert.equal(receipt.outputFingerprint, fingerprintValue(secret))
  assert.equal(receipt.inputFingerprint, fingerprintValue('cmd'))
  assert.equal(JSON.stringify(receipt).includes(secret), false)
})

test('fingerprints are stable for identical inputs', () => {
  assert.equal(fingerprintValue('same'), fingerprintValue('same'))
  assert.notEqual(fingerprintValue('a'), fingerprintValue('b'))
})

test('identical inputs build byte-identical receipts except the clock default', () => {
  const input = { operationId: 'op-10', source: 'git' as const, exitCode: 0, startedAt: 5, durationMs: 5 }
  assert.deepEqual(buildExecutionReceipt(input), buildExecutionReceipt(input))
})

test('isolation metadata survives only when complete and well-typed', () => {
  const good = buildExecutionReceipt({
    operationId: 'op-11',
    source: 'sandbox',
    isolation: { workspaceId: 'ws-1', disposable: true },
  })
  assert.deepEqual(good.isolation, { workspaceId: 'ws-1', disposable: true })
  const bad = buildExecutionReceipt({ operationId: 'op-12', source: 'sandbox', isolation: { workspaceId: 'ws-1' } })
  assert.equal(bad.isolation, undefined)
})

test('identity and source fail closed', () => {
  assert.throws(() => buildExecutionReceipt({ operationId: '', source: 'test' }), /operationId/)
  assert.throws(() => buildExecutionReceipt({ operationId: 'op-13', source: 'model-claim' }), /source/)
  assert.equal(isExecutionReceiptSource('test'), true)
  assert.equal(isExecutionReceiptSource('model-claim'), false)
  assert.equal(isExecutionReceiptStatus('passed'), true)
  assert.equal(isExecutionReceiptStatus('passed-ish'), false)
})

test('oversized identifiers and verifier labels are refused, not truncated silently', () => {
  assert.throws(() => buildExecutionReceipt({ operationId: 'x'.repeat(129), source: 'test' }), /operationId/)
  const receipt = buildExecutionReceipt({ operationId: 'op-14', source: 'test', exitCode: 0, verifier: 'v'.repeat(129) })
  assert.equal(receipt.verifier, undefined)
})
