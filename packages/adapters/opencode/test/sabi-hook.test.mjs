import test from 'node:test'
import assert from 'node:assert/strict'
import SabiOpenCodePlugin, { trustedControllerURL } from '../src/sabi-hook.mjs'

test('OpenCode accepts only loopback controller URLs', () => {
  assert.equal(trustedControllerURL('http://127.0.0.1:7433'), 'http://127.0.0.1:7433')
  assert.equal(trustedControllerURL('http://localhost:7433/'), 'http://localhost:7433')
  assert.equal(trustedControllerURL('http://198.51.100.10:7433'), undefined)
  assert.equal(trustedControllerURL('https://127.0.0.1:7433'), undefined)
})

test('OpenCode fails open without fetching a remote controller URL', async () => {
  const originalFetch = globalThis.fetch
  const originalURL = process.env.SABI_CONTROLLER_URL
  let calls = 0
  process.env.SABI_CONTROLLER_URL = 'http://198.51.100.10:7433'
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('must not fetch')
  }
  try {
    const hooks = await SabiOpenCodePlugin({ directory: '/tmp/sabi-opencode-test' })
    await hooks['chat.message']({}, { parts: [{ type: 'text', text: 'do not send this remotely' }] })
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalURL === undefined) delete process.env.SABI_CONTROLLER_URL
    else process.env.SABI_CONTROLLER_URL = originalURL
  }
})

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
    assert.equal(requests[3].body.sessionId, 'opencode-session-1')
    assert.equal(requests[3].body.outcome, 'started')
    assert.equal(output.parts.length, 1)
    assert.match(output.parts[0].text, /delegated/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenCode records rerouted receipts against the target session as started', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    const payload = String(url).endsWith('/plan')
      ? { action: 'DELEGATE', target: { id: 'session:term-two', agent: 'claude' } }
      : { action: 'DELEGATE', target: { id: 'session:term-two', agent: 'claude' }, execution: { status: 'rerouted', targetId: 'session:term-two' } }
    return { ok: true, async json() { return payload } }
  }
  try {
    const hooks = await SabiOpenCodePlugin({ directory: '/tmp/sabi-opencode-test', worktree: '/tmp/sabi-opencode-test' })
    const output = { parts: [{ type: 'text', text: 'review this change' }] }
    await hooks['chat.message']({ sessionID: 'opencode-session-1' }, output)
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ['/v1/sessions/register', '/plan', '/route', '/v1/sessions/outcome'])
    assert.equal(requests[3].body.sessionId, 'session:term-two')
    assert.equal(requests[3].body.outcome, 'started')
    assert.match(output.parts[0].text, /delegated/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenCode omits the outcome post when a spawn has no addressable session', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    const payload = String(url).endsWith('/plan')
      ? { action: 'SPAWN', target: { agent: 'codex' } }
      : { action: 'SPAWN', target: { agent: 'codex' }, execution: { status: 'started' } }
    return { ok: true, async json() { return payload } }
  }
  try {
    const hooks = await SabiOpenCodePlugin({ directory: '/tmp/sabi-opencode-test', worktree: '/tmp/sabi-opencode-test' })
    const output = { parts: [{ type: 'text', text: 'review this change' }] }
    await hooks['chat.message']({ sessionID: 'opencode-session-1' }, output)
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ['/v1/sessions/register', '/plan', '/route'])
    assert.match(output.parts[0].text, /started/i)
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
