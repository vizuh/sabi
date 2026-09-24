import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  executionReceiptsPath,
  heartbeatSession,
  readExecutionReceipts,
  readSessionRegistry,
  recordExecutionReceipt,
  recordSessionOutcome,
  registerSession,
  registryPath,
} from '../src/registry.ts'

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-registry-'))
}

test('registry stores bounded identities without raw session ids and expires stale entries', () => {
  const stateDir = workspace()
  try {
    const first = registerSession(stateDir, {
      sessionId: 'provider-secret-session-id',
      adapter: 'claude',
      harness: 'claude',
      worktree: stateDir,
      context: 'Frontend session token=secret-value',
    }, 100_000)
    assert.match(first.id, /^registry:claude:/)
    assert.equal(first.id.includes('provider-secret-session-id'), false)
    assert.equal(first.dispatchable, false)
    assert.equal(first.context, 'Frontend session token=[redacted]')
    heartbeatSession(stateDir, {
      sessionId: 'provider-secret-session-id',
      adapter: 'claude',
      harness: 'claude',
      worktree: stateDir,
      lifecycle: 'idle',
    }, 100_001)
    const outcome = recordSessionOutcome(stateDir, {
      sessionId: 'provider-secret-session-id',
      adapter: 'claude',
      harness: 'claude',
      worktree: stateDir,
      lifecycle: 'idle',
      outcome: 'completed',
      receipt: { phase: 'completed', observedAt: '2026-09-20T12:00:00.000Z', requestId: 'orca-request-1' },
    }, 100_002)
    assert.equal(outcome.lastOutcome, 'completed')
    assert.deepEqual(outcome.lastReceipt, { phase: 'completed', observedAt: '2026-09-20T12:00:00.000Z', requestId: 'orca-request-1' })
    const refreshed = heartbeatSession(stateDir, {
      sessionId: 'provider-secret-session-id',
      adapter: 'claude',
      harness: 'claude',
      worktree: stateDir,
      lifecycle: 'active',
    }, 100_003)
    assert.equal(refreshed.lastOutcome, 'completed')
    assert.deepEqual(refreshed.lastReceipt, { phase: 'completed', observedAt: '2026-09-20T12:00:00.000Z', requestId: 'orca-request-1' })
    assert.equal(readSessionRegistry(stateDir, 100_004).length, 1)
    assert.equal(readSessionRegistry(stateDir, 100_004 + 10 * 60_000 + 1).length, 0)
    assert.equal(readFileSync(registryPath(stateDir), 'utf8').includes('provider-secret-session-id'), false)
    assert.equal(existsSync(registryPath(stateDir)), true)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('registry rejects malformed registration fields', () => {
  const stateDir = workspace()
  try {
    assert.throws(() => registerSession(stateDir, {
      sessionId: '', adapter: 'claude', harness: 'claude', worktree: stateDir,
    }), /sessionId is required/)
    assert.throws(() => registerSession(stateDir, {
      sessionId: 'id', adapter: 'claude', harness: 'claude', worktree: stateDir,
      capacity: { status: 'bad' as never },
    }), /unsupported capacity status/)
    assert.throws(() => recordSessionOutcome(stateDir, {
      sessionId: 'id', adapter: 'claude', harness: 'claude', worktree: stateDir,
      outcome: 'failed', receipt: { phase: 'not-a-phase', observedAt: 'now' },
    }), /receipt must include/)
    assert.throws(() => recordSessionOutcome(stateDir, {
      sessionId: 'id', adapter: 'claude', harness: 'claude', worktree: stateDir,
      outcome: 'failed', capsuleMeta: { sourceGeneration: 1 },
    }), /capsuleMeta must include/)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('registry persists only bounded capsule metadata and survives a restart', () => {
  const stateDir = workspace()
  try {
    recordSessionOutcome(stateDir, {
      sessionId: 'capsule-session', adapter: 'codex', harness: 'codex', worktree: stateDir,
      outcome: 'failed',
      receipt: { phase: 'failed', observedAt: '2026-09-20T12:00:00.000Z' },
      capsuleMeta: { failureSignature: 'typescript-error', sourceGeneration: 2 },
    }, 200_000)
    // Simulate a process restart: read back from disk through a fresh call, not held state.
    const restarted = readSessionRegistry(stateDir, 200_001)
    assert.equal(restarted.length, 1)
    assert.deepEqual(restarted[0]!.lastCapsuleMeta, { failureSignature: 'typescript-error', sourceGeneration: 2 })
    assert.equal(readFileSync(registryPath(stateDir), 'utf8').includes('verifiedFacts'), false)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('duplicate outcome delivery for the same session collapses to one bounded entry', () => {
  const stateDir = workspace()
  try {
    const input = {
      sessionId: 'dup-session', adapter: 'codex', harness: 'codex', worktree: stateDir,
      outcome: 'completed' as const,
      receipt: { phase: 'completed' as const, observedAt: '2026-09-20T12:00:00.000Z', requestId: 'req-1' },
      capsuleMeta: { failureSignature: 'typescript-error' },
    }
    const first = recordSessionOutcome(stateDir, input, 300_000)
    const duplicate = recordSessionOutcome(stateDir, input, 300_001)
    assert.equal(first.id, duplicate.id)
    assert.equal(readSessionRegistry(stateDir, 300_002).length, 1)
    assert.deepEqual(duplicate.lastCapsuleMeta, { failureSignature: 'typescript-error' })
    assert.deepEqual(duplicate.lastReceipt, { phase: 'completed', observedAt: '2026-09-20T12:00:00.000Z', requestId: 'req-1' })
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('execution receipts persist by operationId and survive a restart, sanitized', () => {
  const stateDir = workspace()
  try {
    const stored = recordExecutionReceipt(stateDir, {
      operationId: 'op-test-1',
      source: 'test',
      status: 'passed',
      startedAt: 400_000,
      durationMs: 120,
      verifier: 'node --test',
      exitCode: 0,
      expectedScope: 3,
      observedScope: 3,
      changedFiles: ['/abs/path/src/a.ts', 'src/b.ts', 'src/b.ts'],
    })
    assert.equal(stored.operationId, 'op-test-1')
    assert.equal(stored.scopeMismatch, false)
    assert.deepEqual(stored.changedFiles, ['a.ts', 'b.ts'])
    // Simulate a process restart: a fresh read sees the same receipt from disk.
    const after = readExecutionReceipts(stateDir)
    assert.equal(after.length, 1)
    assert.deepEqual(after[0], stored)
    const raw = readFileSync(executionReceiptsPath(stateDir), 'utf8')
    assert.equal(raw.includes('/abs/path'), false)
    assert.equal(raw.includes('op-test-1'), true)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('duplicate execution receipt delivery collapses to one entry', () => {
  const stateDir = workspace()
  try {
    const input = {
      operationId: 'op-dup-1',
      source: 'build' as const,
      status: 'failed' as const,
      startedAt: 410_000,
      durationMs: 55,
      exitCode: 1,
    }
    const first = recordExecutionReceipt(stateDir, input)
    const duplicate = recordExecutionReceipt(stateDir, input)
    assert.deepEqual(duplicate, first)
    const all = readExecutionReceipts(stateDir)
    assert.equal(all.length, 1)
    assert.deepEqual(all[0], first)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('an unknown receipt is strengthened by a later terminal verdict for the same operationId', () => {
  const stateDir = workspace()
  try {
    recordExecutionReceipt(stateDir, {
      operationId: 'op-late-1', source: 'sandbox', status: 'unknown', startedAt: 420_000, durationMs: 0,
    })
    const strengthened = recordExecutionReceipt(stateDir, {
      operationId: 'op-late-1', source: 'test', status: 'passed', startedAt: 420_100, durationMs: 30, verifier: 'node --test', exitCode: 0,
    })
    assert.equal(strengthened.status, 'passed')
    const all = readExecutionReceipts(stateDir)
    assert.equal(all.length, 1)
    assert.equal(all[0]!.status, 'passed')
    assert.equal(all[0]!.verifier, 'node --test')
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('a contradictory terminal verdict never flips a stored execution receipt', () => {
  const stateDir = workspace()
  try {
    recordExecutionReceipt(stateDir, {
      operationId: 'op-flip-1', source: 'test', status: 'failed', startedAt: 430_000, durationMs: 40, exitCode: 1,
    })
    const afterContradiction = recordExecutionReceipt(stateDir, {
      operationId: 'op-flip-1', source: 'test', status: 'passed', startedAt: 430_100, durationMs: 41, exitCode: 0,
    })
    assert.equal(afterContradiction.status, 'failed')
    recordExecutionReceipt(stateDir, {
      operationId: 'op-flip-2', source: 'lint', status: 'passed', startedAt: 431_000, durationMs: 10, exitCode: 0,
    })
    const secondContradiction = recordExecutionReceipt(stateDir, {
      operationId: 'op-flip-2', source: 'lint', status: 'failed', startedAt: 431_100, durationMs: 11, exitCode: 2,
    })
    assert.equal(secondContradiction.status, 'passed')
    const all = readExecutionReceipts(stateDir)
    assert.equal(all.length, 2)
    assert.equal(all.find((entry) => entry.operationId === 'op-flip-1')!.status, 'failed')
    assert.equal(all.find((entry) => entry.operationId === 'op-flip-2')!.status, 'passed')
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('malformed execution receipts are rejected, never stored', () => {
  const stateDir = workspace()
  try {
    assert.throws(() => recordExecutionReceipt(stateDir, {
      source: 'test', status: 'passed', startedAt: 1, durationMs: 1,
    }), /operationId/)
    assert.throws(() => recordExecutionReceipt(stateDir, {
      operationId: 'op-bad-source', source: 'not-a-source', status: 'passed', startedAt: 1, durationMs: 1,
    }), /source/)
    assert.throws(() => recordExecutionReceipt(stateDir, {
      operationId: 'op-bad-status', source: 'test', status: 'green', startedAt: 1, durationMs: 1,
    }), /status/)
    assert.throws(() => recordExecutionReceipt(stateDir, {
      operationId: 'op-bad-clock', source: 'test', status: 'passed', startedAt: 'now', durationMs: 1,
    }), /startedAt/)
    assert.equal(readExecutionReceipts(stateDir).length, 0)
    assert.equal(existsSync(executionReceiptsPath(stateDir)), false)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('execution receipt storage is bounded and keeps the most recent records', () => {
  const stateDir = workspace()
  try {
    const total = 256 + 12
    for (let index = 0; index < total; index += 1) {
      recordExecutionReceipt(stateDir, {
        operationId: `op-bounded-${index}`, source: 'git', status: 'passed', startedAt: 500_000 + index, durationMs: 1,
      })
    }
    const all = readExecutionReceipts(stateDir)
    assert.equal(all.length, 256)
    assert.equal(all.some((entry) => entry.operationId === 'op-bounded-0'), false)
    assert.equal(all.some((entry) => entry.operationId === `op-bounded-${total - 1}`), true)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})
