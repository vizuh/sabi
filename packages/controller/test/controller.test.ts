import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentHarness, AgentSession, ControllerSignals, HandoffSnapshot } from '../src/types.ts'
import { buildRecoveryCapsule, runController, selectRoute, structuredHandoff } from '../src/controller.ts'
import { clearModelHealth, modelHealth } from '../src/model-health.ts'

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
    currentPlan: ['run the focused tests'],
    toolsExecuted: ['shell_command'],
    failures: ['typescript-error'],
    verifications: ['focused tests passed'],
    relevantDiff: '1 file changed',
    nextAction: 'run the focused tests',
  })
  const payload = JSON.parse(message.split('\n')[1]!) as Record<string, unknown>
  assert.equal(payload.objective, 'finish the review')
  assert.deepEqual(payload.filesChanged, ['src/app.ts'])
  assert.deepEqual(payload.currentPlan, ['run the focused tests'])
  assert.deepEqual(payload.toolsExecuted, ['shell_command'])
  assert.deepEqual(payload.failures, ['typescript-error'])
  assert.deepEqual(payload.verifications, ['focused tests passed'])
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

test('failed spawned model reroutes to the next configured model in the same harness', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-model-health-'))
  const binDir = path.join(root, 'bin')
  const fakeOrca = path.join(root, 'orca.js')
  const firstModel = 'opencode/muse-spark-1.3-free'
  const secondModel = 'opencode/ling-3.0-flash-fin-free'
  const harnessName = 'opencode-health-test'
  const fakeHarness = path.join(binDir, harnessName)
  const previousCommand = process.env.ORCA_CLI_COMMAND
  const previousHandle = process.env.ORCA_TERMINAL_HANDLE
  const previousHarnesses = process.env.SABI_CONTROLLER_HARNESSES
  const previousPath = process.env.PATH

  mkdirSync(binDir)
  writeFileSync(fakeHarness, `#!/usr/bin/env node
const args = process.argv.slice(2)
const firstModel = ${JSON.stringify(firstModel)}
const secondModel = ${JSON.stringify(secondModel)}
const cwd = ${JSON.stringify(root)}
const commandIndex = args.indexOf('--command')
const command = commandIndex >= 0 ? args[commandIndex + 1] ?? '' : ''
const handleIndex = args.indexOf('--terminal')
const handle = handleIndex >= 0 ? args[handleIndex + 1] : undefined
const textIndex = args.indexOf('--text')
const text = textIndex >= 0 ? args[textIndex + 1] ?? '' : ''
let result
if (args[0] === 'worktree' && args[1] === 'ps') {
  result = { worktrees: [{ path: cwd, branch: 'main' }] }
} else if (args[0] === 'terminal' && args[1] === 'list') {
  result = { terminals: [{ handle: 'term-current', worktreePath: cwd, branch: 'main', connected: true, writable: true, orphaned: false, title: 'current', preview: 'idle', agentIdentity: ${JSON.stringify(harnessName)} }] }
} else if (args[0] === 'terminal' && args[1] === 'create') {
  result = { handle: command.includes(firstModel) ? 'spawn-first' : command.includes(secondModel) ? 'spawn-second' : 'spawn-unknown' }
} else if (args[0] === 'terminal' && args[1] === 'send') {
  result = handle === 'spawn-first'
    ? { requestId: 'first-request', inputAccepted: false, turnStarted: false }
    : { requestId: 'second-request', inputAccepted: true, turnStarted: true }
} else if (args[0] === 'terminal' && args[1] === 'wait') {
  result = { wait: { satisfied: true, status: 'idle' } }
} else if (args[0] === 'terminal' && args[1] === 'read') {
  result = handle === 'spawn-first'
    ? { terminal: { tail: ['quota exhausted'] } }
    : handle === 'spawn-second'
      ? { terminal: { tail: ['❯ ' + text, '● done'] } }
      : { terminal: { tail: ['❯'] } }
} else if (args[0] === 'terminal' && args[1] === 'close') {
  result = { closed: true }
} else if (args[0] === 'models' || args[0] === '--list-models') {
  result = undefined
  process.stdout.write(firstModel + '\\n' + secondModel + '\\n')
  process.exit(0)
} else if (args[0] === '--version') {
  result = undefined
  process.stdout.write('opencode-health-test 1.18.31\\n')
  process.exit(0)
} else {
  result = {}
}
console.log(JSON.stringify({ id: 'model-health-test', ok: true, result }))
`)
  chmodSync(fakeHarness, 0o755)
  writeFileSync(fakeOrca, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const result = spawnSync(${JSON.stringify(fakeHarness)}, process.argv.slice(2), { encoding: 'utf8' })
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
`)
  chmodSync(fakeOrca, 0o755)
  clearModelHealth()
  process.env.ORCA_CLI_COMMAND = fakeOrca
  process.env.ORCA_TERMINAL_HANDLE = 'term-current'
  process.env.SABI_CONTROLLER_HARNESSES = harnessName
  process.env.PATH = `${binDir}:${previousPath ?? ''}`
  try {
    const result = await runController(
      'spawn a fresh harness for this bounded read-only check',
      root,
      { ...signals, cwd: root, orcaAvailable: true, matchingWorktree: true, matchingTerminal: true },
      undefined,
      10,
      true,
      { harnesses: { [harnessName]: { preferredModels: [firstModel, secondModel] } } },
    )
    assert.equal(result.selection.action, 'SPAWN')
    assert.equal(result.selection.target?.kind, 'harness')
    assert.equal(result.selection.target?.model, firstModel)
    assert.equal(result.execution.status, 'rerouted')
    assert.equal(result.execution.reroutedFrom, 'harness:opencode-health-test')
    assert.equal(result.execution.targetId, 'harness:opencode-health-test')
    assert.equal(result.execution.model, secondModel)
    assert.equal(result.execution.modelHealth?.status, 'healthy')
    assert.equal(modelHealth(harnessName, firstModel)?.status, 'unavailable')
    assert.equal(modelHealth(harnessName, secondModel)?.status, 'healthy')
  } finally {
    clearModelHealth()
    if (previousCommand === undefined) delete process.env.ORCA_CLI_COMMAND
    else process.env.ORCA_CLI_COMMAND = previousCommand
    if (previousHandle === undefined) delete process.env.ORCA_TERMINAL_HANDLE
    else process.env.ORCA_TERMINAL_HANDLE = previousHandle
    if (previousHarnesses === undefined) delete process.env.SABI_CONTROLLER_HARNESSES
    else process.env.SABI_CONTROLLER_HARNESSES = previousHarnesses
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})

test('recovery capsule survives structured handoff serialization and stays distinct from the receipt', () => {
  const capsule = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    verifiedFacts: [{ label: 'build fails on strict null checks', status: 'verified', source: 'tool', receiptBacked: true }],
    attemptedApproaches: ['retry-same'],
    verifiedNonSolutions: [{ label: 'bumping tsconfig target did not help', status: 'verified', source: 'tool', receiptBacked: true }],
    lastKnownCleanPoint: 'before-auth-migration',
    recommendedNextAction: 'retry-with-feedback',
    sourceGeneration: 1,
  })
  assert.ok(capsule)
  const message = structuredHandoff('finish the review', { ...handoff, recoveryCapsule: capsule })
  const payload = JSON.parse(message.split('\n')[1]!) as Record<string, unknown>
  assert.deepEqual(payload.recoveryCapsule, capsule)
  assert.equal('receiptId' in capsule!, false)
  assert.equal('idempotencyKey' in capsule!, false)
  assert.equal('targetId' in capsule!, false)
})

test('recovery capsule stays within the configured handoff character bound', () => {
  const longLabel = 'x'.repeat(500)
  const capsule = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    verifiedFacts: Array.from({ length: 20 }, (_, index) => ({ label: `${longLabel}-${index}`, status: 'observed' as const, source: 'tool' as const })),
    attemptedApproaches: Array.from({ length: 20 }, (_, index) => `${longLabel}-${index}`),
    verifiedNonSolutions: Array.from({ length: 20 }, (_, index) => ({ label: `${longLabel}-${index}`, status: 'observed' as const, source: 'tool' as const })),
  })
  assert.ok(capsule)
  assert.ok(JSON.stringify(capsule).length <= 2_000)
})

test('recovery capsule downgrades unreceipted and stale claims', () => {
  const unreceipted = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    verifiedFacts: [
      { label: 'model claims the fix works', status: 'verified', source: 'summary', receiptBacked: false },
      { label: 'test suite passed', status: 'verified', source: 'tool', receiptBacked: true },
    ],
  })
  assert.ok(unreceipted)
  assert.equal(unreceipted!.verifiedFacts[0]!.status, 'unverified')
  assert.equal(unreceipted!.verifiedFacts[1]!.status, 'verified')

  const stale = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    verifiedFacts: [{ label: 'test suite passed before compaction', status: 'verified', source: 'tool', receiptBacked: true }],
    recommendedNextAction: 'retry-with-feedback',
    sourceGeneration: 1,
    currentGeneration: 2,
  })
  assert.ok(stale)
  assert.equal(stale!.verifiedFacts[0]!.status, 'unverified')
  assert.equal(stale!.recommendedNextAction, undefined)
})

test('recovery capsule drops secret-like labels before handoff', () => {
  const capsule = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    attemptedApproaches: ['sk-live-ABCDEF1234567890abcdef', 'safe retry'],
    verifiedFacts: [{ label: 'BEGIN RSA PRIVATE KEY', status: 'observed', source: 'summary' }],
  })
  assert.ok(capsule)
  assert.deepEqual(capsule!.attemptedApproaches, ['safe retry'])
  assert.deepEqual(capsule!.verifiedFacts, [])
})

test('a stale clean point is never carried as a rollback bound', () => {
  const stale = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    lastKnownCleanPoint: 'before-auth-migration',
    sourceGeneration: 1,
    currentGeneration: 2,
  })
  assert.ok(stale)
  assert.equal(stale!.lastKnownCleanPoint, undefined)
  const current = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    lastKnownCleanPoint: 'before-auth-migration',
    sourceGeneration: 2,
    currentGeneration: 2,
  })
  assert.ok(current)
  assert.equal(current!.lastKnownCleanPoint, 'before-auth-migration')
  const unanchored = buildRecoveryCapsule({
    failureSignature: 'typescript-error',
    lastKnownCleanPoint: 'before-auth-migration',
  })
  assert.ok(unanchored)
  assert.equal(unanchored!.lastKnownCleanPoint, 'before-auth-migration')
})
