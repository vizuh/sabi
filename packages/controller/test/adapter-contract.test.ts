import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  assert.equal(adapterReady(manifests.find(({ id }) => id === 'hermes')!), false)
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

test('probed preparer harnesses declare only what the 2026-09-29 probes established', () => {
  const manifests = builtInAdapterManifests()
  for (const id of ['hermes', 'prime-agent', 'pi', 'omp']) {
    const manifest = manifests.find((m) => m.id === id)!
    assert.equal(manifest.status, 'partial')
    assert.equal(manifest.operations.dispatch, 'cli')
    assert.equal(manifest.operations['observe-outcome'], 'cli')
    assert.equal(manifest.operations['receive-prompt'], 'missing')
    assert.equal(adapterReady(manifest), false)
    const probe = JSON.parse(readFileSync(new URL(`../src/probes/${id}.json`, import.meta.url), 'utf8'))
    assert.equal(probe.detect.value, true)
    assert.equal(manifest.consent, 'unavailable')
    assert.equal(probe.scriptedSession.value, true)
    assert.equal(probe.routeInference.value, true)
    assert.equal(probe.result.treeChanged, false)
  }
})
