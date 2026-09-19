import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverAgents } from '../src/inventory.ts'

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
