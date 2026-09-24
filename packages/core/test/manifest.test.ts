import test from 'node:test'
import assert from 'node:assert/strict'
import { loadAdapterManifest } from '../src/manifest.ts'

/**
 * Machine-readable adapter manifests (spec 005 US3, T030). Outcomes are
 * explicit: accept / refuse-with-reason / capability-downgrade. A manifest is
 * a declaration, never a capability probe — Sabi consumes it.
 */

const valid = {
  adapterProtocol: 2,
  id: 'opencode',
  hostVersions: '>=1.18',
  kind: 'opencode',
  version: '1.18.31',
  loop: 'proxy',
  surfaces: { inference: true, controller: true },
  capabilities: [
    { key: 'sessionIdentity', declared: true },
    { key: 'turnIdentity', declared: true },
    { key: 'cancel', declared: true },
    { key: 'modelSwitch', declared: true },
    { key: 'effortSwitch', declared: false },
    { key: 'receipts', declared: true },
  ],
}

test('a valid manifest is accepted with no refusals', () => {
  const result = loadAdapterManifest(valid)
  assert.equal(result.ok, true)
  assert.equal(result.manifest?.id, 'opencode')
  assert.equal(result.manifest?.kind, 'opencode')
  assert.equal(result.manifest?.loop, 'proxy')
  assert.deepEqual(result.refusals, [])
})

test('a manifest older than the minimum protocol is refused with an upgrade hint', () => {
  const result = loadAdapterManifest({ ...valid, adapterProtocol: 1 })
  assert.equal(result.ok, false)
  assert.ok(result.refusals.some((r) => r.surface === 'adapterProtocol'))
  assert.match(result.refusals.find((r) => r.surface === 'adapterProtocol')!.reason, /older than Sabi's minimum/)
})

test('a manifest missing required fields is refused field-by-field', () => {
  const result = loadAdapterManifest({ adapterProtocol: 2, id: 'x' })
  assert.equal(result.ok, false)
  const surfaces = result.refusals.map((r) => r.surface)
  assert.ok(surfaces.includes('kind'))
  assert.ok(surfaces.includes('version'))
  assert.ok(surfaces.includes('loop'))
})

test('an over-claiming capability is refused, not silently granted', () => {
  const result = loadAdapterManifest({
    ...valid,
    capabilities: [{ key: 'modelSwitch', declared: true }],
  }, { requiredCapabilities: ['receipts'] })
  assert.equal(result.ok, false)
  assert.ok(result.refusals.some((r) => r.surface === 'receipts'))
})

test('an undeclared capability downgrades the adapter instead of refusing it', () => {
  const result = loadAdapterManifest({
    ...valid,
    capabilities: [
      { key: 'sessionIdentity', declared: true },
      { key: 'effortSwitch', declared: false },
    ],
  })
  assert.equal(result.ok, true)
  assert.ok(result.downgrades.some((d) => d.key === 'effortSwitch'))
  assert.equal(result.manifest?.capabilities?.length, 2)
})

test('a manifest that is not a JSON object is refused', () => {
  const result = loadAdapterManifest(null)
  assert.equal(result.ok, false)
  assert.ok(result.refusals.some((r) => r.surface === 'manifest'))
})

test('an unknown kind is refused, never coerced to a valid label', () => {
  const result = loadAdapterManifest({ ...valid, kind: 'totally-not-a-adapter' })
  assert.equal(result.ok, false)
  assert.ok(result.refusals.some((r) => r.surface === 'kind'))
})

test('a declared refusal beats a silent absence', () => {
  const result = loadAdapterManifest({
    ...valid,
    refusals: [{ surface: 'paidSpend', reason: 'adapter refuses to spend' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.manifest?.refusals?.[0]?.surface, 'paidSpend')
})

test('the default minimum protocol is the current one', () => {
  const result = loadAdapterManifest(valid)
  assert.equal(result.ok, true)
  // protocol == CURRENT_PROTOCOL (2) is accepted; protocol 1 is refused.
  const stale = loadAdapterManifest({ ...valid, adapterProtocol: 1 })
  assert.equal(stale.ok, false)
})