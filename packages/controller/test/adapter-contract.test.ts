import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADAPTER_OPERATIONS,
  adapterReady,
  builtInAdapterManifests,
  validateAdapterManifest,
} from '../src/adapter-contract.ts'

test('built-in adapter manifests expose every required operation without overstating readiness', () => {
  const manifests = builtInAdapterManifests()
  assert.deepEqual(manifests.find(({ id }) => id === 'claude')?.operations && Object.keys(manifests.find(({ id }) => id === 'claude')!.operations).sort(), [...ADAPTER_OPERATIONS].sort())
  assert.equal(adapterReady(manifests.find(({ id }) => id === 'claude')!), false)
  assert.equal(manifests.find(({ id }) => id === 'orca')?.operations['receive-prompt'], 'missing')
  assert.equal(manifests.find(({ id }) => id === 'deepseek-harness')?.status, 'inference-only')
  assert.equal(manifests.find(({ id }) => id === 'deepseek-harness')?.operations['receive-prompt'], 'missing')
  assert.equal(manifests.find(({ id }) => id === 'hermes')?.status, 'unsupported')
})

test('adapter manifest validation rejects missing or unknown operation modes', () => {
  const manifest = builtInAdapterManifests().find(({ id }) => id === 'codex')!
  assert.doesNotThrow(() => validateAdapterManifest(manifest))
  assert.throws(() => validateAdapterManifest({ ...manifest, operations: { ...manifest.operations, dispatch: 'guess' } }), /dispatch.*native, hook, cli or missing/)
  assert.throws(() => validateAdapterManifest({ ...manifest, operations: { ...manifest.operations, detect: undefined } }), /detect.*native, hook, cli or missing/)
  assert.equal(adapterReady(validateAdapterManifest({
    ...manifest,
    status: 'integrated',
    operations: Object.fromEntries(ADAPTER_OPERATIONS.map((operation) => [operation, 'native'])),
  })), true)
})
