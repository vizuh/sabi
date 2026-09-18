import test from 'node:test'
import assert from 'node:assert/strict'
import { JUDGE_QUESTIONS, type JudgeConfig } from '@sabi/core'
import { createTypesafeClient } from '../src/typesafe.ts'

const config: JudgeConfig = { enabled: true, baseURL: 'http://127.0.0.1/unused', timeoutMs: 50 }

test('Jev retry delay is bounded by one total judge deadline', async () => {
  let calls = 0
  const client = createTypesafeClient({ fetchImpl: (async () => {
    calls += 1
    return new Response('', { status: 429, headers: { 'retry-after': '1' } })
  }) as typeof fetch })
  await assert.rejects(() => client.ask({}, JUDGE_QUESTIONS, config), /aborted/i)
  assert.equal(calls, 1)
})

test('parent cancellation reaches Jev fetch and prevents any retry', async () => {
  let calls = 0
  const controller = new AbortController()
  const client = createTypesafeClient({ fetchImpl: (async (_url, init) => {
    calls += 1
    controller.abort(new DOMException('client aborted', 'AbortError'))
    assert.equal(init?.signal?.aborted, true)
    init?.signal?.throwIfAborted()
    return new Response('')
  }) as typeof fetch })
  await assert.rejects(() => client.ask({}, JUDGE_QUESTIONS, config, controller.signal), /client aborted/i)
  assert.equal(calls, 1)
})

test('an already cancelled request never calls Jev', async () => {
  let calls = 0
  const client = createTypesafeClient({ fetchImpl: (async () => { calls += 1; return new Response('') }) as typeof fetch })
  await assert.rejects(() => client.ask({}, JUDGE_QUESTIONS, config, AbortSignal.abort()), /aborted/i)
  assert.equal(calls, 0)
})
