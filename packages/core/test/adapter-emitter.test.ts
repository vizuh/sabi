import test from 'node:test'
import assert from 'node:assert/strict'
import { ADAPTER_IDS, createAdapterEmitter, unknownFields } from '../src/adapter-emitter.ts'

const base = {
  adapter: 'command-code' as const,
  operationId: 'op-1',
  source: 'test' as const,
  status: 'passed' as const,
  exitCode: 0,
  verifier: 'pytest',
  startedAt: 1,
  durationMs: 100,
  isolation: { workspaceId: 'ws-1', disposable: true },
}

test('every adapter id is declared', () => {
  assert.deepEqual([...ADAPTER_IDS], [
    'command-code', 'opencode', 'hermes', 'oh-my-pi', 'prime-agent', 'orca', 'deepseek-harness', 'kilo', 'cline',
  ])
})

test('an emitter names its operation id with the adapter prefix', () => {
  const emit = createAdapterEmitter('command-code')
  const receipt = emit.emit(base)
  assert.equal(receipt.operationId, 'command-code:op-1')
  assert.equal(receipt.status, 'passed')
  assert.equal(receipt.verifier, 'pytest')
  assert.equal(receipt.isolation?.workspaceId, 'ws-1')
})

test('an emitter rejects a ctx from a different adapter', () => {
  const emit = createAdapterEmitter('opencode')
  assert.throws(() => emit.emit(base), /opencode/)
})

test('an emitter refuses an unallowlisted source', () => {
  const emit = createAdapterEmitter('command-code')
  assert.throws(() => emit.emit({ ...base, source: 'model-claim' as never }), /source/)
})

test('missing signals become explicit unknowns, never zeros', () => {
  const emit = createAdapterEmitter('command-code')
  const receipt = emit.emit({ adapter: 'command-code', operationId: 'op-2', source: 'edit' })
  assert.equal(receipt.status, 'unknown')
  assert.equal(receipt.exitCode, undefined)
  assert.deepEqual(unknownFields({ adapter: 'command-code', operationId: 'op-2', source: 'edit' }), [
    'exitCode', 'verifier', 'expectedScope', 'observedScope', 'isolation',
  ])
})

test('two adapters emit the same core shape and can be joined', () => {
  const a = createAdapterEmitter('command-code').emit({ ...base, operationId: 'op-a' })
  const b = createAdapterEmitter('opencode').emit({ ...base, adapter: 'opencode', operationId: 'op-b' })
  const keys = Object.keys(a).sort()
  assert.deepEqual(Object.keys(b).sort(), keys)
  assert.notEqual(a.operationId, b.operationId)
})

test('fingerprints are stable across identical emits', () => {
  const emit = createAdapterEmitter('command-code')
  const one = emit.emit({ ...base, inputText: 'same', outputText: 'same' })
  const two = emit.emit({ ...base, inputText: 'same', outputText: 'same' })
  assert.equal(one.inputFingerprint, two.inputFingerprint)
  assert.equal(one.outputFingerprint, two.outputFingerprint)
})