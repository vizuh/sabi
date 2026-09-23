import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPABILITY_KEYS,
  defaultCapabilities,
  gateCapabilities,
  isCapable,
  isCapabilityFlag,
} from '../src/capabilities.ts'
import type { ExecutionCapabilities } from '../src/types.ts'

test('an unknown harness gates everything off', () => {
  for (const key of CAPABILITY_KEYS) {
    assert.equal(isCapable(undefined, key), false)
    assert.equal(isCapable(defaultCapabilities(), key), false)
  }
})

test('only an explicit true enables a capability', () => {
  const caps: ExecutionCapabilities = {
    verifierReceipts: true,
    isolatedWorkspaces: false,
    repoMap: 'unknown',
  }
  assert.equal(isCapable(caps, 'verifierReceipts'), true)
  assert.equal(isCapable(caps, 'isolatedWorkspaces'), false)
  assert.equal(isCapable(caps, 'repoMap'), false)
  assert.equal(isCapable(caps, 'deterministicEdit'), false)
})

test('a full harness enables receipt-dependent actions', () => {
  const caps: ExecutionCapabilities = {
    repoMap: true,
    incrementalContext: true,
    deterministicEdit: true,
    isolatedWorkspaces: true,
    verifierReceipts: true,
    eventDrivenChanges: true,
  }
  assert.deepEqual(gateCapabilities(caps, ['verifierReceipts', 'isolatedWorkspaces']), { ok: true, missing: [] })
})

test('a partial harness reports exactly what is missing', () => {
  const caps: ExecutionCapabilities = { verifierReceipts: true }
  assert.deepEqual(gateCapabilities(caps, ['verifierReceipts', 'isolatedWorkspaces']), {
    ok: false,
    missing: ['isolatedWorkspaces'],
  })
})

test('a none harness degrades explicitly, never silently', () => {
  const gate = gateCapabilities({ isolatedWorkspaces: false }, ['verifierReceipts'])
  assert.equal(gate.ok, false)
  assert.deepEqual(gate.missing, ['verifierReceipts'])
})

test('capability flags validate strictly', () => {
  assert.equal(isCapabilityFlag(true), true)
  assert.equal(isCapabilityFlag(false), true)
  assert.equal(isCapabilityFlag('unknown'), true)
  assert.equal(isCapabilityFlag('yes'), false)
  assert.equal(isCapabilityFlag(1), false)
  assert.equal(isCapabilityFlag(undefined), false)
})

test('all six capability keys are declared', () => {
  assert.deepEqual([...CAPABILITY_KEYS], [
    'repoMap',
    'incrementalContext',
    'deterministicEdit',
    'isolatedWorkspaces',
    'verifierReceipts',
    'eventDrivenChanges',
  ])
})
