import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clearInventoryCache, discoverAgents, parseModelCatalog, parseModelList, selectPreferredModel } from '../src/inventory.ts'
import { clearModelHealth, recordModelReceipt } from '../src/model-health.ts'

test('local harness model catalog matching stays exact and provider-free', () => {
  const output = 'opencode-go/kimi-k3\nopencode-go/gpt-5.6-luna\nAvailable models · 2 models'
  assert.deepEqual(parseModelList(output), ['opencode-go/kimi-k3', 'opencode-go/gpt-5.6-luna'])
  assert.equal(selectPreferredModel(output, ['opencode-go/kimi-k3']), 'opencode-go/kimi-k3')
  assert.equal(selectPreferredModel(output, ['moonshotai/kimi-k3']), undefined)
})

test('formatted Command Code catalogs keep model ids and discard provider headings', () => {
  const output = [
    'Available models · 72 models',
    'Open Source',
    'deepseek/deepseek-v4-flash             fast reasoning',
    'Anthropic',
    'claude-sonnet-5                         recommended',
    'OpenAI',
    'gpt-5.6-luna                            cost-sensitive',
    'Pass the full id, or just the short name after the last "/":',
    'cmd --model gpt-5.6-luna',
    'Docs: https://commandcode.ai/docs/reference/cli/models',
  ].join('\n')
  assert.deepEqual(parseModelList(output), [
    'deepseek/deepseek-v4-flash',
    'claude-sonnet-5',
    'gpt-5.6-luna',
  ])
})

test('catalog roles distinguish judge evidence from worker evidence', () => {
  const output = 'opencode/jev-1.13-free\nopencode-go/kimi-k3\n'
  const catalog = parseModelCatalog(output, { command: 'opencode' })
  assert.equal(catalog.models.find((model) => model.id === 'opencode/jev-1.13-free')?.role, 'judge')
  assert.equal(selectPreferredModel(output, ['opencode/jev-1.13-free', 'opencode-go/kimi-k3']), 'opencode-go/kimi-k3')
  assert.equal(catalog.models.some((model) => model.id === 'opencode/jev-1.13-free' && model.role === 'worker'), false)
  assert.equal(catalog.models.find((model) => model.id === 'opencode-go/kimi-k3')?.role, 'worker')
})

test('runtime catalog evidence classifies free markers and Jev without inventing entitlement', () => {
  const output = [
    'opencode/jev-1.13-free',
    'opencode/muse-spark-1.3-contributor-free',
    'opencode-go/kimi-k3',
  ].join('\n')
  const catalog = parseModelCatalog(output, { command: 'opencode', runtimeVersion: '1.18.31', observedAt: 123 })

  assert.equal(catalog.command, 'opencode')
  assert.equal(catalog.runtimeVersion, '1.18.31')
  assert.equal(catalog.observedAt, 123)
  assert.equal(catalog.modelCount, 3)
  assert.equal(catalog.truncated, undefined)
  assert.match(catalog.outputSha256, /^[a-f0-9]{64}$/)
  assert.equal(catalog.sourceRevision, undefined)
  assert.deepEqual(catalog.models, [
    { id: 'opencode/jev-1.13-free', costClass: 'explicit-free', role: 'judge' },
    { id: 'opencode/muse-spark-1.3-contributor-free', costClass: 'explicit-free', role: 'worker' },
    { id: 'opencode-go/kimi-k3', costClass: 'unknown', role: 'worker' },
  ])
})

test('preferred worker selection sees ids beyond the bounded catalog evidence', () => {
  const models = Array.from({ length: 300 }, (_, index) => `opencode/worker-${index}`)
  const output = models.join('\n')
  const catalog = parseModelCatalog(output, { command: 'opencode' })
  assert.equal(catalog.modelCount, 300)
  assert.equal(catalog.models.length, 256)
  assert.equal(catalog.truncated, true)
  assert.equal(selectPreferredModel(output, ['opencode/worker-299']), 'opencode/worker-299')
})

test('discovered OpenCode spawn candidates carry the observed runtime catalog', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-catalog-cwd-'))
  const harnessDir = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-catalog-bin-'))
  const opencode = path.join(harnessDir, 'opencode')
  writeFileSync(opencode, '#!/bin/sh\ncase "$1" in --version) echo 1.18.31-test;; models) printf "opencode/jev-1.13-free\\nopencode/muse-spark-1.3-contributor-free\\n";; esac\n')
  chmodSync(opencode, 0o755)
  const previousCommand = process.env.ORCA_CLI_COMMAND
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE
  const previousHarnesses = process.env.SABI_CONTROLLER_HARNESSES
  const previousPath = process.env.PATH
  process.env.ORCA_CLI_COMMAND = fakeOrca(cwd)
  process.env.ORCA_TERMINAL_HANDLE = 'term-idle'
  process.env.SABI_CONTROLLER_HARNESSES = 'opencode'
  process.env.PATH = `${harnessDir}${path.delimiter}${previousPath ?? ''}`
  try {
    const inventory = discoverAgents(cwd, {
      controller: { harnesses: { opencode: { preferredModels: ['opencode/jev-1.13-free', 'opencode/muse-spark-1.3-contributor-free'] } } },
    })
    const candidate = inventory.spawnCandidates.find((entry) => entry.agent === 'opencode')
    assert.equal(candidate?.catalog?.runtimeVersion, '1.18.31-test')
    assert.deepEqual(candidate?.catalog?.models.map((model) => model.id), [
      'opencode/jev-1.13-free',
      'opencode/muse-spark-1.3-contributor-free',
    ])
    assert.equal(candidate?.catalog?.models[0]?.role, 'judge')
    assert.equal(candidate?.catalog?.models[1]?.costClass, 'explicit-free')
    assert.equal(candidate?.model, 'opencode/muse-spark-1.3-contributor-free')
    assert.equal(candidate?.available, false)
  } finally {
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle
    if (previousHarnesses === undefined) delete process.env.SABI_CONTROLLER_HARNESSES
    else process.env.SABI_CONTROLLER_HARNESSES = previousHarnesses
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
  }
})

test('a failed preferred OpenCode model moves selection to the next catalog model and fails open when all fail', () => {
  const first = 'opencode/muse-spark-1.3-free'
  const second = 'opencode/ling-3.0-flash-fin-free'
  clearModelHealth()
  try {
    const output = `${first}\n${second}\n`
    assert.equal(selectPreferredModel(output, [first, second], 'opencode'), first)
    recordModelReceipt({ harness: 'opencode', model: first, outcome: 'failed', latencyMs: 80 })
    assert.equal(selectPreferredModel(output, [first, second], 'opencode'), second)

    recordModelReceipt({ harness: 'opencode', model: second, outcome: 'failed', latencyMs: 90 })
    assert.equal(selectPreferredModel(output, [first, second], 'opencode'), first)
  } finally {
    clearModelHealth()
  }
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
    assert.equal(inventory.active.dispatchable, false)
    assert.match(inventory.active.id, /^session:host:/)
  } finally {
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
  }
})

test('inventory cache is short-lived and explicit refresh bypasses it', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-inventory-cache-'))
  const other = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-inventory-cache-other-'))
  const previousCommand = process.env.ORCA_CLI_COMMAND
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE
  process.env.ORCA_CLI_COMMAND = fakeGlobalOrca(cwd, other)
  process.env.ORCA_TERMINAL_HANDLE = 'term-current'
  try {
    clearInventoryCache()
    const first = discoverAgents(cwd)
    const cached = discoverAgents(cwd)
    const refreshed = discoverAgents(cwd, { refresh: true })
    assert.equal(first.cached, false)
    assert.equal(cached.cached, true)
    assert.equal(refreshed.cached, false)
    assert.equal(refreshed.observedAt >= first.observedAt, true)
  } finally {
    clearInventoryCache()
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle
  }
})
