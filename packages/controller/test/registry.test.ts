import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { heartbeatSession, readSessionRegistry, recordSessionOutcome, registerSession, registryPath } from '../src/registry.ts'

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
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})
