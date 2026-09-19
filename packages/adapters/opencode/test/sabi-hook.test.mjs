import test from 'node:test'
import assert from 'node:assert/strict'
import SabiOpenCodePlugin from '../src/sabi-hook.mjs'

test('OpenCode chat.message plans first and replaces the submitted parts after dispatch', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    const payload = String(url).endsWith('/plan')
      ? { action: 'DELEGATE', target: { id: 'session:claude-1', agent: 'claude' } }
      : { action: 'DELEGATE', target: { agent: 'claude' }, execution: { status: 'started' } }
    return { ok: true, async json() { return payload } }
  }
  try {
    const hooks = await SabiOpenCodePlugin({ directory: '/tmp/sabi-opencode-test', worktree: '/tmp/sabi-opencode-test' })
    const output = { parts: [{ type: 'text', text: 'review this change' }] }
    await hooks['chat.message']({ sessionID: 'opencode-session-1' }, output)
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ['/v1/sessions/register', '/plan', '/route', '/v1/sessions/outcome'])
    assert.equal(requests[0].body.adapter, 'opencode')
    assert.deepEqual(requests[2].body.override, { sessionId: 'session:claude-1' })
    assert.equal(output.parts.length, 1)
    assert.match(output.parts[0].text, /delegated/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenCode leaves a prompt alone when the controller keeps it local', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, async json() { return { action: 'CONTINUE' } } })
  try {
    const hooks = await SabiOpenCodePlugin({ directory: '/tmp/sabi-opencode-test' })
    const output = { parts: [{ type: 'text', text: 'what is 2 + 2?' }] }
    await hooks['chat.message']({ sessionID: 'opencode-session-1' }, output)
    assert.deepEqual(output.parts, [{ type: 'text', text: 'what is 2 + 2?' }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenCode sends the daemon bearer token when configured', async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.SABI_CONTROLLER_TOKEN
  const headers = []
  process.env.SABI_CONTROLLER_TOKEN = 'test-controller-token'
  globalThis.fetch = async (_url, options) => {
    headers.push(options.headers)
    return { ok: true, async json() { return { action: 'CONTINUE' } } }
  }
  try {
    const hooks = await SabiOpenCodePlugin({ directory: '/tmp/sabi-opencode-test' })
    await hooks['chat.message']({}, { parts: [{ type: 'text', text: 'what is 2 + 2?' }] })
    assert.equal(headers[0].authorization, 'Bearer test-controller-token')
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.SABI_CONTROLLER_TOKEN
    else process.env.SABI_CONTROLLER_TOKEN = originalToken
  }
})
