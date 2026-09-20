import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentHarness, AgentSession, ControllerSignals, HandoffSnapshot } from '../src/types.ts'
import { runController, selectRoute, structuredHandoff } from '../src/controller.ts'

const signals: ControllerSignals = {
  cwd: '/tmp/sabi-controller',
  requestGiven: true,
  multiScope: false,
  gitClean: true,
  stuckSession: false,
  sabiLogSampled: 0,
  orcaAvailable: true,
  matchingWorktree: true,
  matchingTerminal: true,
}

const handoff: HandoffSnapshot = {
  objective: 'what is 2 + 2?',
  originalRequest: 'what is 2 + 2?',
  sourceSession: 'session:current',
  repo: 'sabi',
  progress: 'request received',
  workCompleted: 'none',
  changedFiles: [],
  branch: 'main',
  worktree: '/tmp/sabi-controller',
  testsRun: [],
  latestResults: [],
  unresolvedWork: ['what is 2 + 2?'],
  relevantDiff: '',
  nextAction: 'what is 2 + 2?',
}

function session(id: string, agent: string, handle?: string): AgentSession {
  return {
    kind: 'session',
    id,
    handle,
    agent,
    harness: agent,
    capabilities: ['coding'],
    available: true,
    lifecycle: 'idle',
    capacity: { status: 'available' },
    worktree: '/tmp/sabi-controller',
  }
}

function harness(id: string, agent: string): AgentHarness {
  return {
    kind: 'harness',
    id,
    agent,
    harness: agent,
    command: agent,
    capabilities: ['coding'],
    available: true,
    capacity: { status: 'available' },
  }
}

test('2 + 2 remains CONTINUE even when another terminal shares the worktree', async () => {
  const active = session('session:current', 'codex', 'term-current')
  const result = await selectRoute(
    'what is 2 + 2?',
    '/tmp/sabi-controller',
    signals,
    {
      orcaAvailable: true,
      worktreeCount: 1,
      observedAt: Date.now(),
      cached: false,
      matchingWorktree: true,
      matchingTerminal: true,
      active,
      existingSessions: [session('session:claude', 'claude', 'term-claude')],
      spawnCandidates: [harness('harness:codex', 'codex')],
    },
    handoff,
    undefined,
  )

  assert.equal(result.action, 'CONTINUE')
  assert.equal(result.target?.id, 'session:current')
  assert.deepEqual(result.validActions, ['CONTINUE'])
  assert.equal(result.decisionSource, 'deterministic')
  assert.equal(result.jev.status, 'not-consulted')
})

test('ordinary "start a new" wording does not spawn a real harness', async () => {
  const active = session('session:current', 'codex', 'term-current')
  const result = await selectRoute(
    'start a new test file for this fix',
    '/tmp/sabi-controller',
    signals,
    {
      orcaAvailable: true,
      worktreeCount: 1,
      observedAt: Date.now(),
      cached: false,
      matchingWorktree: true,
      matchingTerminal: true,
      active,
      existingSessions: [],
      spawnCandidates: [harness('harness:claude', 'claude')],
    },
    { ...handoff, objective: 'start a new test file for this fix', originalRequest: 'start a new test file for this fix' },
    undefined,
  )

  assert.equal(result.action, 'CONTINUE')
  assert.equal(result.target?.id, 'session:current')
  assert.deepEqual(result.validActions, ['CONTINUE'])
})

test('cross-worktree handoff preserves structured objective, diff and next step', () => {
  const message = structuredHandoff('finish the review', {
    ...handoff,
    objective: 'finish the review',
    changedFiles: ['src/app.ts'],
    relevantDiff: '1 file changed',
    nextAction: 'run the focused tests',
  })
  const payload = JSON.parse(message.split('\n')[1]!) as Record<string, unknown>
  assert.equal(payload.objective, 'finish the review')
  assert.deepEqual(payload.filesChanged, ['src/app.ts'])
  assert.equal(payload.diff, '1 file changed')
  assert.equal(payload.nextSuggestedStep, 'run the focused tests')
  assert.match(message, /\[REQUEST\]\nfinish the review/)
})

test('quota failure refreshes inventory and reroutes through the next eligible session', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-reroute-'))
  const state = path.join(root, 'state')
  const fakeOrca = path.join(root, 'orca.js')
  writeFileSync(fakeOrca, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const cwd = ${JSON.stringify(root)}
const state = ${JSON.stringify(state)}
const handleIndex = args.indexOf('--terminal')
const handle = handleIndex >= 0 ? args[handleIndex + 1] : undefined
const textIndex = args.indexOf('--text')
const text = textIndex >= 0 ? args[textIndex + 1] : ''
let result
if (args[0] === 'worktree' && args[1] === 'ps') {
  result = { worktrees: [{ path: cwd, branch: 'main' }] }
} else if (args[0] === 'terminal' && args[1] === 'list') {
  result = { terminals: [
    { handle: 'term-current', worktreePath: cwd, branch: 'main', connected: true, writable: true, orphaned: false, title: 'current', preview: 'quota exhausted', agentIdentity: 'codex' },
    { handle: 'term-one', worktreePath: cwd, branch: 'main', connected: true, writable: true, orphaned: false, title: 'first target', agentIdentity: 'opencode' },
    { handle: 'term-two', worktreePath: cwd, branch: 'main', connected: true, writable: true, orphaned: false, title: 'second target', agentIdentity: 'claude' },
  ] }
} else if (args[0] === 'terminal' && args[1] === 'send') {
  if (handle === 'term-one') fs.writeFileSync(state, 'failed')
  result = { requestId: handle + '-request', inputAccepted: handle !== 'term-one', turnStarted: handle !== 'term-one' }
} else if (args[0] === 'terminal' && args[1] === 'wait') {
  result = { wait: { satisfied: true, status: 'running' } }
} else if (args[0] === 'terminal' && args[1] === 'read') {
  result = { terminal: { tail: fs.existsSync(state) && handle === 'term-one' ? ['quota exhausted'] : ['❯ ' + text, '● done'] } }
} else {
  result = {}
}
console.log(JSON.stringify({ id: 'reroute-test', ok: true, result }))
`)
  chmodSync(fakeOrca, 0o755)
  const previousCommand = process.env.ORCA_CLI_COMMAND
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE
  const previousHarnesses = process.env.SABI_CONTROLLER_HARNESSES
  process.env.ORCA_CLI_COMMAND = fakeOrca
  process.env.ORCA_TERMINAL_HANDLE = 'term-current'
  process.env.SABI_CONTROLLER_HARNESSES = 'missing-harness'
  try {
    const result = await runController(
      'delegate this read-only check',
      root,
      { ...signals, cwd: root, orcaAvailable: true, matchingWorktree: true, matchingTerminal: true },
      undefined,
      10,
      true,
    )
    assert.equal(result.selection.action, 'DELEGATE')
    assert.equal(result.execution.status, 'rerouted')
    assert.equal(result.execution.targetId, 'session:term-two')
    assert.equal(result.execution.reroutedFrom, 'session:term-one')
    assert.equal(result.execution.rerouteCount, 1)
  } finally {
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle
    if (previousHarnesses === undefined) delete process.env.SABI_CONTROLLER_HARNESSES
    else process.env.SABI_CONTROLLER_HARNESSES = previousHarnesses
    rmSync(root, { recursive: true, force: true })
  }
})
