import test from 'node:test'
import assert from 'node:assert/strict'
import { planAgentRoute, catalogFreeWorkerCount } from '../src/agents.ts'
import type { AgentHarness, AgentRoutingInput, AgentSession, HandoffSnapshot } from '../src/types.ts'

const now = Date.parse('2026-09-19T12:00:00.000Z')

const handoff: HandoffSnapshot = {
  objective: 'finish the agent-controller review',
  originalRequest: 'finish the agent-controller review',
  sourceSession: 'claude-main',
  repo: 'sabi',
  progress: 'implementation complete; final independent review remains',
  workCompleted: 'capacity-aware routing and the existing controller tests',
  changedFiles: ['packages/controller/src/agents.ts'],
  branch: 'feat/agent-controller',
  worktree: '/work/sabi-agent-controller',
  testsRun: ['npm test'],
  latestResults: ['304 Node tests passing', 'typecheck clean'],
  unresolvedWork: ['run the final acceptance check'],
  latestFailure: 'Claude usage limit reached',
  relevantDiff: 'capacity gate plus structured handoff',
  nextAction: 'continue the independent review from the existing diff',
}

const costs = {
  handoffMs: 60_000,
  replacementExecutionMs: 120_000,
  rateLimitThresholdMs: 5 * 60_000,
}

function active(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    kind: 'session',
    id: 'claude-main',
    agent: 'Claude Code',
    harness: 'command-code',
    capabilities: ['typescript', 'review'],
    available: true,
    lifecycle: 'active',
    authenticated: true,
    capacity: { status: 'quota_exhausted', resetAt: now + 39 * 60_000 },
    ...patch,
  }
}

function session(id: string, agent: string, patch: Partial<AgentSession> = {}): AgentSession {
  return {
    ...active(),
    id,
    agent,
    lifecycle: 'idle',
    capacity: { status: 'available' },
    ...patch,
  }
}

function harness(id: string, agent: string, patch: Partial<AgentHarness> = {}): AgentHarness {
  return {
    kind: 'harness',
    id,
    agent,
    harness: 'command-code',
    capabilities: ['typescript', 'review'],
    available: true,
    capacity: { status: 'available' },
    command: 'cmd',
    ...patch,
  }
}

function input(patch: Partial<AgentRoutingInput> = {}): AgentRoutingInput {
  return {
    now,
    active: active(),
    existingSessions: [session('codex-warm', 'Codex')],
    spawnCandidates: [harness('command-code-new', 'CommandCode')],
    requiredCapabilities: ['typescript', 'review'],
    costs,
    handoff,
    ...patch,
  }
}

test('quota exhausted beyond the transfer cost delegates with a complete handoff', () => {
  const plan = planAgentRoute(input())

  assert.equal(plan.action, 'DELEGATE')
  assert.equal(plan.rule, 'quota-exhausted')
  assert.equal(plan.currentEligible, false)
  assert.ok(!plan.eligibleAgentIds.includes('claude-main'))
  assert.equal(plan.target?.id, 'codex-warm')
  assert.equal(plan.target?.agent, 'Codex')
  assert.deepEqual(plan.handoff, handoff)
  assert.equal(plan.handoff.objective, 'finish the agent-controller review')
  assert.equal(plan.handoff.progress, 'implementation complete; final independent review remains')
  assert.deepEqual(plan.handoff.changedFiles, ['packages/controller/src/agents.ts'])
  assert.equal(plan.handoff.branch, 'feat/agent-controller')
  assert.equal(plan.handoff.worktree, '/work/sabi-agent-controller')
  assert.deepEqual(plan.handoff.latestResults, ['304 Node tests passing', 'typecheck clean'])
  assert.deepEqual(plan.handoff.unresolvedWork, ['run the final acceptance check'])
})

test('without a suitable existing session, the same hard trigger selects a suitable harness to spawn', () => {
  const plan = planAgentRoute(input({ existingSessions: [] }))

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.kind, 'harness')
  assert.equal(plan.target?.id, 'command-code-new')
  assert.equal(plan.currentEligible, false)
})

test('OpenCode is a valid live spawn target when its CLI is available', () => {
  const plan = planAgentRoute(
    input({
      existingSessions: [],
      spawnCandidates: [harness('harness:opencode', 'opencode', { harness: 'opencode', command: 'opencode' })],
    }),
  )

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.id, 'harness:opencode')
  assert.equal(plan.target?.agent, 'opencode')
})

test('the active session is reconsidered after its quota reset', () => {
  const plan = planAgentRoute(
    input({
      now: now + 39 * 60_000 + 1,
      existingSessions: [],
      spawnCandidates: [],
    }),
  )

  assert.equal(plan.action, 'CONTINUE')
  assert.equal(plan.currentEligible, true)
  assert.ok(plan.eligibleAgentIds.includes('claude-main'))
  assert.equal(plan.reconsiderAt, undefined)
})

test('a short reset stays eligible when waiting costs less than handoff', () => {
  const plan = planAgentRoute(
    input({
      active: active({ capacity: { status: 'quota_exhausted', resetAt: now + 30_000 } }),
      existingSessions: [],
      spawnCandidates: [],
    }),
  )

  assert.equal(plan.action, 'CONTINUE')
  assert.equal(plan.currentEligible, true)
  assert.equal(plan.estimatedWaitMs, 30_000)
  assert.equal(plan.transferCostMs, 180_000)
})

test('a rate limit beyond the explicit threshold delegates instead of waiting', () => {
  const plan = planAgentRoute(
    input({
      active: active({ capacity: { status: 'rate_limited', resetAt: now + 6 * 60_000 } }),
      existingSessions: [session('codex-warm', 'Codex')],
      spawnCandidates: [],
    }),
  )

  assert.equal(plan.action, 'DELEGATE')
  assert.equal(plan.rule, 'rate-limited')
  assert.match(plan.reason, /exceeds the wait threshold/)
})

test('healthy capacity wins over a lower-priority fallback', () => {
  const plan = planAgentRoute(
    input({
      existingSessions: [
        session('claude-low-priority', 'Claude Code', {
          capacity: { status: 'quota_exhausted', fallbackMode: 'lower_priority' },
        }),
        session('codex-warm', 'Codex'),
      ],
    }),
  )

  assert.equal(plan.action, 'DELEGATE')
  assert.equal(plan.target?.id, 'codex-warm')
})

test('preferred OpenCode plan wins when both replacement sessions are healthy', () => {
  const plan = planAgentRoute(input({
    active: active({ capacity: { status: 'quota_exhausted' } }),
    existingSessions: [
      session('command-code-warm', 'command-code', { harness: 'command-code' }),
      session('opencode-warm', 'opencode', { harness: 'opencode' }),
    ],
    preferredHarnesses: ['opencode', 'command-code'],
  }))

  assert.equal(plan.action, 'DELEGATE')
  assert.equal(plan.target?.id, 'opencode-warm')
})

test('the Orca fallback order can include every requested harness', () => {
  const plan = planAgentRoute(input({
    active: active({ capacity: { status: 'quota_exhausted' } }),
    existingSessions: [],
    spawnCandidates: [
      harness('harness:claude', 'claude', { harness: 'claude' }),
      harness('harness:codex', 'codex', { harness: 'codex' }),
      harness('harness:hermes', 'hermes', { harness: 'hermes', command: 'hermes' }),
    ],
    preferredHarnesses: ['opencode', 'command-code', 'claude', 'codex', 'hermes'],
  }))

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.agent, 'claude')
})

test('hard blockers are deterministic before any quality judgment', () => {
  const cases: Array<{ patch: Partial<AgentSession>; rule: string }> = [
    { patch: { lifecycle: 'dead' }, rule: 'process-dead' },
    { patch: { authenticated: false }, rule: 'authentication-unavailable' },
    { patch: { lifecycle: 'blocked' }, rule: 'blocked' },
    { patch: { lifecycle: 'waiting' }, rule: 'waiting' },
    { patch: { failureStreak: 2 }, rule: 'repeated-failure' },
    { patch: { capabilities: ['typescript'] }, rule: 'required-capability-unavailable' },
  ]

  for (const { patch, rule } of cases) {
    const plan = planAgentRoute(input({ active: active(patch) }))
    assert.equal(plan.rule, rule)
    assert.equal(plan.action, 'DELEGATE')
    assert.equal(plan.currentEligible, false)
  }
})

test('catalog-free-worker count is zero when no catalog is present and counts explicit-free workers only', () => {
  assert.equal(catalogFreeWorkerCount(undefined), 0)
  assert.equal(catalogFreeWorkerCount({ models: [] } as never), 0)
  assert.equal(catalogFreeWorkerCount({
    models: [
      { id: 'opencode/muse-free', costClass: 'explicit-free', role: 'worker' },
      { id: 'opencode/jev-free', costClass: 'explicit-free', role: 'judge' },
      { id: 'opencode-go/kimi-k3', costClass: 'unknown', role: 'worker' },
    ],
  } as never), 1)
})

test('a harness with more free catalog workers wins when capacity and preference are equal', () => {
  const fewFree = harness('harness:hermes', 'hermes', {
    harness: 'hermes',
    command: 'hermes',
    catalog: {
      command: 'hermes',
      outputSha256: 'a',
      observedAt: now,
      modelCount: 1,
      models: [{ id: 'nous/hermes-free', costClass: 'explicit-free', role: 'worker' }],
    },
  })
  const manyFree = harness('harness:opencode', 'opencode', {
    harness: 'opencode',
    command: 'opencode',
    catalog: {
      command: 'opencode',
      outputSha256: 'b',
      observedAt: now,
      modelCount: 4,
      models: [
        { id: 'opencode/muse-free', costClass: 'explicit-free', role: 'worker' },
        { id: 'opencode/ling-free', costClass: 'explicit-free', role: 'worker' },
        { id: 'opencode/jev-free', costClass: 'explicit-free', role: 'judge' },
        { id: 'opencode-go/kimi-k3', costClass: 'unknown', role: 'worker' },
      ],
    },
  })
  // Neither is listed in preferredHarnesses, so both share the same preference index.
  const plan = planAgentRoute(input({
    existingSessions: [],
    spawnCandidates: [fewFree, manyFree],
    preferredHarnesses: ['claude', 'codex'],
    useFreeCatalog: true,
  }))

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.id, 'harness:opencode')
})

test('free-catalog preference is silent when useFreeCatalog is off', () => {
  const fewFree = harness('harness:hermes', 'hermes', {
    harness: 'hermes',
    command: 'hermes',
    catalog: {
      command: 'hermes',
      outputSha256: 'a',
      observedAt: now,
      modelCount: 1,
      models: [{ id: 'nous/hermes-free', costClass: 'explicit-free', role: 'worker' }],
    },
  })
  const manyFree = harness('harness:opencode', 'opencode', {
    harness: 'opencode',
    command: 'opencode',
    catalog: {
      command: 'opencode',
      outputSha256: 'b',
      observedAt: now,
      modelCount: 3,
      models: [
        { id: 'opencode/muse-free', costClass: 'explicit-free', role: 'worker' },
        { id: 'opencode/jev-free', costClass: 'explicit-free', role: 'judge' },
        { id: 'opencode-go/kimi-k3', costClass: 'unknown', role: 'worker' },
      ],
    },
  })
  const plan = planAgentRoute(input({
    existingSessions: [],
    spawnCandidates: [fewFree, manyFree],
    preferredHarnesses: ['hermes', 'opencode'],
    useFreeCatalog: false,
  }))

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.id, 'harness:hermes')
})

test('a harness without a catalog is never penalized by free-catalog scoring', () => {
  const noCatalog = harness('harness:hermes', 'hermes', { harness: 'hermes', command: 'hermes' })
  const withCatalog = harness('harness:opencode', 'opencode', {
    harness: 'opencode',
    command: 'opencode',
    catalog: {
      command: 'opencode',
      outputSha256: 'b',
      observedAt: now,
      modelCount: 1,
      models: [{ id: 'opencode/muse-free', costClass: 'explicit-free', role: 'worker' }],
    },
  })
  // No preferredHarnesses: both have equal preference (0), so free-catalog decides.
  const plan = planAgentRoute(input({
    existingSessions: [],
    spawnCandidates: [noCatalog, withCatalog],
    useFreeCatalog: true,
  }))

  // The catalog-bearing harness wins; the one without a catalog is neutral (score 0), not penalized.
  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.id, 'harness:opencode')
})

test('free-catalog is a tiebreak after preference, not a replacement for it', () => {
  const bothOneFree = harness('harness:hermes', 'hermes', {
    harness: 'hermes',
    command: 'hermes',
    catalog: {
      command: 'hermes',
      outputSha256: 'a',
      observedAt: now,
      modelCount: 1,
      models: [{ id: 'nous/hermes-free', costClass: 'explicit-free', role: 'worker' }],
    },
  })
  const manyFree = harness('harness:opencode', 'opencode', {
    harness: 'opencode',
    command: 'opencode',
    catalog: {
      command: 'opencode',
      outputSha256: 'b',
      observedAt: now,
      modelCount: 3,
      models: [
        { id: 'opencode/muse-free', costClass: 'explicit-free', role: 'worker' },
        { id: 'opencode/another-free', costClass: 'explicit-free', role: 'worker' },
        { id: 'opencode/jev-free', costClass: 'explicit-free', role: 'judge' },
      ],
    },
  })
  // Both at the same preference index (not listed), so free-catalog decides.
  const plan = planAgentRoute(input({
    existingSessions: [],
    spawnCandidates: [bothOneFree, manyFree],
    preferredHarnesses: ['claude', 'codex'],
    useFreeCatalog: true,
  }))

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.id, 'harness:opencode')
})

test('explicit preference still outranks free-catalog when they conflict', () => {
  const bothOneFree = harness('harness:hermes', 'hermes', {
    harness: 'hermes',
    command: 'hermes',
    catalog: {
      command: 'hermes',
      outputSha256: 'a',
      observedAt: now,
      modelCount: 1,
      models: [{ id: 'nous/hermes-free', costClass: 'explicit-free', role: 'worker' }],
    },
  })
  const manyFree = harness('harness:opencode', 'opencode', {
    harness: 'opencode',
    command: 'opencode',
    catalog: {
      command: 'opencode',
      outputSha256: 'b',
      observedAt: now,
      modelCount: 2,
      models: [
        { id: 'opencode/muse-free', costClass: 'explicit-free', role: 'worker' },
        { id: 'opencode/jev-free', costClass: 'explicit-free', role: 'judge' },
      ],
    },
  })
  // Hermes is explicitly preferred first, so it wins despite fewer free workers.
  const plan = planAgentRoute(input({
    existingSessions: [],
    spawnCandidates: [bothOneFree, manyFree],
    preferredHarnesses: ['hermes', 'opencode'],
    useFreeCatalog: true,
  }))

  assert.equal(plan.action, 'SPAWN')
  assert.equal(plan.target?.id, 'harness:hermes')
})
