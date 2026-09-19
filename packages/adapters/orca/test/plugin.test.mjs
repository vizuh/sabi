import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import activate, { dispatchToTerminal, normalizeDispatchArgs, selectTerminal } from '../main.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

test('manifest stays within Orca plugin API v1 and requests only bridge capabilities', () => {
  const manifest = JSON.parse(readFileSync(path.join(here, '..', 'orca-plugin.json'), 'utf8'))
  assert.equal(manifest.manifestVersion, 1)
  assert.equal(manifest.pluginApi, 1)
  assert.equal(manifest.main, 'main.mjs')
  assert.deepEqual(manifest.capabilities, [
    { kind: 'workspace:read' },
    { kind: 'terminal:send' },
    { kind: 'events:subscribe' },
  ])
  assert.deepEqual(manifest.contributes.commands.map(({ id }) => id), ['sabi.dispatch'])
})

test('dispatch arguments accept a request and an optional explicit terminal', () => {
  assert.deepEqual(normalizeDispatchArgs({ prompt: ' review this ', terminalId: 'term-2' }), {
    request: 'review this',
    terminalId: 'term-2',
  })
  assert.equal(selectTerminal({ terminals: [{ id: 'term-1' }] }), 'term-1')
  assert.throws(() => selectTerminal({ terminals: [{ id: 'term-1' }] }, 'term-2'), /outside the focused worktree/)
})

test('activation registers the command, subscribes events, and sends through Orca', async () => {
  const commands = new Map()
  const events = new Map()
  const calls = []
  const logs = []
  const orca = {
    commands: { register(id, handler) { commands.set(id, handler) } },
    events: { on(name, handler) { events.set(name, handler) } },
    host: {
      async call(name, params) {
        calls.push({ name, params })
        if (name === 'workspace.readContext') {
          return { branch: 'main', displayName: 'sabi', terminals: [{ id: 'term-opencode' }] }
        }
        return { accepted: true }
      },
    },
    log(message) { logs.push(message) },
  }

  activate(orca)
  assert.equal(commands.size, 1)
  assert.equal(events.size, 3)
  const result = await commands.get('sabi.dispatch')({ request: 'run the OpenCode smoke check', terminalId: 'term-opencode' })

  assert.deepEqual(result, {
    ok: true,
    action: 'DISPATCH',
    terminalId: 'term-opencode',
    branch: 'main',
    displayName: 'sabi',
  })
  assert.deepEqual(calls, [
    { name: 'workspace.readContext', params: {} },
    { name: 'terminal.sendText', params: { terminalId: 'term-opencode', text: 'run the OpenCode smoke check', enter: true } },
  ])
  assert.match(logs[0], /term-opencode/)
  await dispatchToTerminal(orca, 'read-only follow-up')
})
