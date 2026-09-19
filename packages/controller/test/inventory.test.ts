import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverAgents, parseModelList, selectPreferredModel } from '../src/inventory.ts'

test('local harness model catalog matching stays exact and provider-free', () => {
  const output = 'opencode-go/kimi-k3\nopencode-go/gpt-5.6-luna\nAvailable models · 2 models'
  assert.deepEqual(parseModelList(output), ['opencode-go/kimi-k3', 'opencode-go/gpt-5.6-luna'])
  assert.equal(selectPreferredModel(output, ['opencode-go/kimi-k3']), 'opencode-go/kimi-k3')
  assert.equal(selectPreferredModel(output, ['moonshotai/kimi-k3']), undefined)
})

function fakeOrca(cwd: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-inventory-'))
  const script = path.join(dir, 'orca-ide.js')
  const source = `#!/usr/bin/env node
const args = process.argv.slice(2)
const cwd = ${JSON.stringify(cwd)}
const handle = 'term-idle'
let result
if (args[0] === 'worktree' && args[1] === 'ps') {
  result = { worktrees: [{ path: cwd, branch: 'main' }] }
} else if (args[0] === 'terminal' && args[1] === 'list') {
  result = { terminals: [{ handle, worktreePath: cwd, branch: 'main', connected: true, writable: true, orphaned: false, title: 'idle session', preview: 'old stop hook error; usage limit reached', agentIdentity: 'claude' }] }
} else if (args[0] === 'terminal' && args[1] === 'read') {
  result = { terminal: { tail: ['old stop hook error', 'usage limit reached', '❯'] } }
} else if (args[0] === 'terminal' && args[1] === 'wait') {
  result = { wait: { satisfied: true, status: 'running' } }
} else {
  result = {}
}
console.log(JSON.stringify({ id: 'fake', ok: true, result }))
`
  writeFileSync(script, source)
  chmodSync(script, 0o755)
  return script
}

function fakeGlobalOrca(currentCwd: string, otherCwd: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-inventory-global-'))
  const script = path.join(dir, 'orca-ide.js')
  const source = `#!/usr/bin/env node
const args = process.argv.slice(2)
const currentCwd = ${JSON.stringify(currentCwd)}
const otherCwd = ${JSON.stringify(otherCwd)}
const terminals = [
  { handle: 'term-current', worktreePath: currentCwd, branch: 'main', connected: true, writable: true, orphaned: false, title: 'current', agentIdentity: 'codex' },
  { handle: 'term-other', worktreePath: otherCwd, branch: 'feature', connected: true, writable: true, orphaned: false, title: 'other', preview: 'https://example.test/reset?reset_password_token=secret-value', agentIdentity: 'claude' },
]
let result
if (args[0] === 'worktree' && args[1] === 'ps') result = { worktrees: [{ path: currentCwd, branch: 'main' }, { path: otherCwd, branch: 'feature' }] }
else if (args[0] === 'terminal' && args[1] === 'list') result = { terminals }
else if (args[0] === 'terminal' && args[1] === 'read') result = { terminal: { tail: ['❯'] } }
else if (args[0] === 'terminal' && args[1] === 'wait') result = { wait: { satisfied: true, status: 'running' } }
else result = {}
console.log(JSON.stringify({ id: 'fake-global', ok: true, result }))
`
  writeFileSync(script, source)
  chmodSync(script, 0o755)
  return script
}

test('historical screen errors do not block an idle live session', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-cwd-'))
  const previousCommand = process.env.ORCA_CLI_COMMAND
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE
  process.env.ORCA_CLI_COMMAND = fakeOrca(cwd)
  process.env.ORCA_TERMINAL_HANDLE = 'term-idle'
  try {
    const inventory = discoverAgents(cwd)
    assert.equal(inventory.active.lifecycle, 'idle')
    assert.equal(inventory.active.available, true)
    assert.deepEqual(inventory.active.capacity, { status: 'available' })
  } finally {
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle
  }
})

test('inventory includes eligible idle sessions from other Orca worktrees', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-current-'))
  const other = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-other-'))
  const previousCommand = process.env.ORCA_CLI_COMMAND
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE
  process.env.ORCA_CLI_COMMAND = fakeGlobalOrca(cwd, other)
  process.env.ORCA_TERMINAL_HANDLE = 'term-current'
  try {
    const inventory = discoverAgents(cwd)
    assert.equal(inventory.active.id, 'session:term-current')
    assert.equal(inventory.existingSessions.length, 1)
    assert.equal(inventory.existingSessions[0]?.id, 'session:term-other')
    assert.equal(inventory.existingSessions[0]?.worktree, path.resolve(other))
    assert.equal(inventory.existingSessions[0]?.branch, 'feature')
    assert.doesNotMatch(inventory.existingSessions[0]?.context ?? '', /secret-value/)
    assert.match(inventory.existingSessions[0]?.context ?? '', /reset_password_token=\[redacted\]/)
  } finally {
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle
  }
})

test('a harness hook can identify the current host session without an Orca terminal handle', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-host-session-'))
  const previousCommand = process.env.ORCA_CLI_COMMAND
  process.env.ORCA_CLI_COMMAND = fakeOrca(cwd)
  try {
    const inventory = discoverAgents(cwd, { currentSession: 'provider-session-1', currentHarness: 'claude' })
    assert.equal(inventory.active.agent, 'claude')
    assert.equal(inventory.active.available, true)
    assert.equal(inventory.active.handle, undefined)
    assert.match(inventory.active.id, /^session:host:/)
  } finally {
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
  }
})
