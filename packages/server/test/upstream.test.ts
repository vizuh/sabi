import test from 'node:test'
import assert from 'node:assert/strict'
import { chatResponseFromJson, readErrorText, readResponseText, usageFromJson } from '../src/upstream.ts'

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

test('a non-UTF-8 error body decodes leniently while success bodies stay strict', async () => {
  // A Latin-1 HTML error page behind a 429: the status/transport classification must survive.
  const latin1 = Buffer.from([0x3c, 0x68, 0x31, 0x3e, 0xe9, 0x3c, 0x2f, 0x68, 0x31, 0x3e])
  const text = await readErrorText(new Response(latin1))
  assert.ok(text.includes('<h1>') && text.includes('</h1>'), 'error text survives with replacements')
  await assert.rejects(() => readResponseText(new Response(Buffer.from(latin1))), 'success bodies stay strict')
})
