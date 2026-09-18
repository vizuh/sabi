import test from 'node:test'
import assert from 'node:assert/strict'
import { chatResponseFromJson, usageFromJson } from '../src/upstream.ts'

test('usage requires known non-negative integer input and output counts', () => {
  for (const usage of [null, {}, { prompt_tokens: 20 }, { completion_tokens: 1 },
    { prompt_tokens: '20', completion_tokens: 1 }, { prompt_tokens: -20, completion_tokens: 1 },
    { prompt_tokens: 20, completion_tokens: Infinity }, { prompt_tokens: 1.5, completion_tokens: 1 },
    { prompt_tokens: 20, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 21 } }]) {
    assert.equal(usageFromJson({ usage }), undefined)
  }
  assert.deepEqual(usageFromJson({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 })
})

test('non-chat JSON and provider error objects are not successful completions', () => {
  for (const value of [null, [], 'ok', {}, { error: { message: 'failed' } }, { choices: [] }, { choices: [null] }]) {
    assert.throws(() => chatResponseFromJson(value), /invalid upstream/)
  }
})
