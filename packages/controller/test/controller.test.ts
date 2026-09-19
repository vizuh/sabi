import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentHarness, AgentSession, ControllerSignals, HandoffSnapshot } from '../src/types.ts'
import { selectRoute } from '../src/controller.ts'

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
