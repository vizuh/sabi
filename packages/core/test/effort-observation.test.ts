import test from 'node:test'
import assert from 'node:assert/strict'
import { observeEffort } from '../src/index.ts'

test('observeEffort records a lone reasoning_effort as client effort', () => {
  assert.deepEqual(observeEffort({ reasoning_effort: 'high' }), { value: 'high', source: 'client' })
})

test('observeEffort records a lone reasoning.effort as client effort', () => {
  assert.deepEqual(observeEffort({ reasoning: { effort: 'low' } }), { value: 'low', source: 'client' })
})

test('observeEffort reports unspecified when no effort control is present', () => {
  assert.deepEqual(observeEffort({}), { source: 'unspecified' })
  assert.deepEqual(observeEffort({ reasoning: { enabled: true } }), { source: 'unspecified' })
})

test('observeEffort reports unspecified on conflicting or malformed controls', () => {
  // Both forms together are rejected by the compatibility gate; never record either as fact.
  assert.deepEqual(
    observeEffort({ reasoning_effort: 'high', reasoning: { effort: 'low' } }),
    { source: 'unspecified' },
  )
  assert.deepEqual(observeEffort({ reasoning_effort: '  ' }), { source: 'unspecified' })
  assert.deepEqual(observeEffort({ reasoning_effort: 3 }), { source: 'unspecified' })
  assert.deepEqual(observeEffort({ reasoning: { effort: '' } }), { source: 'unspecified' })
  assert.deepEqual(observeEffort({ reasoning: 'high' }), { source: 'unspecified' })
})
