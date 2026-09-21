import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendCouncilLedgerReceipt,
  councilPreGate,
  createCouncilPlanReceipt,
  minCallsForMode,
  newCouncilLedgerReceipt,
  readCouncilLedgerReceipts,
  type CouncilIndependence,
  type CouncilPlan,
  type SurplusResource,
} from '../src/index.ts'

function resource(alias = 'sabi-quality'): SurplusResource {
  return {
    alias,
    tier: alias,
    provider: 'openrouter',
    model: 'free/model',
    trust: 'external-free',
    cost: { input: 0, output: 0 },
    capabilities: { text: true, tools: false },
  }
}

test('minCallsForMode returns the minimum provider calls per mode', () => {
  assert.equal(minCallsForMode('none'), 0)
  assert.equal(minCallsForMode('probe'), 1)
  assert.equal(minCallsForMode('panel'), 2)
  assert.equal(minCallsForMode('debate'), 2)
  assert.equal(minCallsForMode('council'), 3)
})

test('councilPreGate: mode none is always viable', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'none', maxCalls: 0 })
  assert.equal(result.ok, true)
  assert.equal(result.reason, 'viable')
})

test('councilPreGate: blocks when no zero-cost resource', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'probe', maxCalls: 5, changedFiles: ['src/a.ts'], diff: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-resource')
})

test('councilPreGate: blocks when budget below mode minimum', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'panel', maxCalls: 1, resources: [resource()], changedFiles: ['src/a.ts'] })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'budget-exceeded')
})

test('councilPreGate: blocks on sensitive file paths', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'probe', maxCalls: 5, resources: [resource()], changedFiles: ['.env', 'src/a.ts'], diff: 'safe' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'sensitive-paths')
})

test('councilPreGate: blocks on canary markers in diff', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'probe', maxCalls: 5, resources: [resource()], changedFiles: ['src/a.ts'], diff: 'Authorization: Bearer sk-12345678901234567890' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'secret-marker')
})

test('councilPreGate: blocks when no diff or changed files', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'probe', maxCalls: 5, resources: [resource()] })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-uncertainty')
})

test('councilPreGate: viable when all gates pass', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'probe', maxCalls: 5, resources: [resource()], changedFiles: ['src/a.ts'], diff: 'some diff' })
  assert.equal(result.ok, true)
  assert.equal(result.reason, 'viable')
})

test('councilPreGate: public scope is a note, not a hard block', () => {
  const result = councilPreGate({ intent: 'bug-hunt', mode: 'probe', maxCalls: 5, resources: [resource()], changedFiles: ['src/a.ts'], diff: 'some diff' }, process.cwd())
  assert.equal(result.ok, true)
  if (result.ok && result.note !== undefined) {
    assert.equal(result.note, 'public-scope')
  }
})

test('CouncilPlan accepts the unsure reason', () => {
  const plan: CouncilPlan = {
    version: 1,
    mode: 'none',
    intent: 'bug-hunt',
    reason: 'unsure',
    seats: [],
    crossExamination: false,
    maxCalls: 0,
  }
  assert.equal(plan.reason, 'unsure')
})

test('council ledger receipts sanitize unknown fields, default and validate independence', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-council-core-'))
  const file = path.join(dir, 'council.jsonl')
  try {
    const receipt = newCouncilLedgerReceipt({
      taskKey: 'task-1',
      harness: 'opencode',
      stage: 'review',
      mode: 'probe',
      intent: 'api-contract',
      status: 'completed',
      evidence: 'execution',
      source: 'live',
      claimCount: 2,
      now: new Date('2026-09-20T22:00:00.000Z'),
    })
    appendCouncilLedgerReceipt(receipt, file)
    assert.equal(readCouncilLedgerReceipts(file)[0]?.independence, 'full')

    const reducedReceipt = newCouncilLedgerReceipt({
      taskKey: 'task-1',
      harness: 'opencode',
      stage: 'review',
      mode: 'probe',
      intent: 'api-contract',
      status: 'completed',
      evidence: 'execution',
      source: 'live',
      independence: 'reduced',
      claimCount: 2,
      now: new Date('2026-09-20T22:00:00.000Z'),
    })
    appendCouncilLedgerReceipt({ ...reducedReceipt, rawPrompt: 'do not persist', credentials: 'do not persist' } as typeof receipt, file)
    assert.equal(readCouncilLedgerReceipts(file).length, 2)
    assert.equal(readCouncilLedgerReceipts(file)[1]?.independence, 'reduced')
    assert.doesNotMatch(readFileSync(file, 'utf8'), /do not persist/)

    assert.equal(newCouncilLedgerReceipt({
      taskKey: 'task-1',
      harness: 'opencode',
      stage: 'review',
      mode: 'probe',
      intent: 'api-contract',
      status: 'completed',
      evidence: 'execution',
      source: 'live',
      independence: 'bogus' as CouncilIndependence,
      claimCount: 0,
    }).independence, 'full')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('appendCouncilLedgerReceipt writes a ledger file that only the owner can read', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-council-mode-'))
  const file = path.join(dir, 'nested', 'council.jsonl')
  try {
    const receipt = newCouncilLedgerReceipt({
      taskKey: 'task-1',
      harness: 'opencode',
      stage: 'review',
      mode: 'probe',
      intent: 'api-contract',
      status: 'completed',
      evidence: 'execution',
      source: 'live',
      claimCount: 0,
      now: new Date('2026-09-20T22:00:00.000Z'),
    })
    appendCouncilLedgerReceipt(receipt, file)
    // POSIX-only — Windows has no owner/group/other permission bits to assert on.
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600)
      assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createCouncilPlanReceipt: writes plan receipt with hash and independence full when synthesizer present', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-council-plan-'))
  const file = path.join(dir, 'council.jsonl')
  try {
    const plan: CouncilPlan = {
      version: 1,
      mode: 'probe',
      intent: 'bug-hunt',
      reason: 'single-uncertainty',
      seats: [{ seatId: 'seat-0', objective: 'review', capability: 'text', harness: 'opencode' }],
      crossExamination: false,
      maxCalls: 1,
      synthesizer: { harness: 'claude', provider: 'anthropic', model: 'sonnet' },
    }
    const receipt = createCouncilPlanReceipt(plan, [resource()], file, new Date('2026-09-20T22:00:00.000Z'))
    assert.equal(receipt.stage, 'plan')
    assert.equal(receipt.status, 'planned')
    assert.equal(receipt.evidence, 'none')
    assert.equal(receipt.source, 'live')
    assert.equal(receipt.independence, 'full')
    assert.ok(receipt.planSha256)
    assert.ok(receipt.inventorySha256)
    assert.equal(receipt.mode, 'probe')
    assert.equal(receipt.intent, 'bug-hunt')

    const rows = readCouncilLedgerReceipts(file)
    assert.equal(rows[0]?.stage, 'plan')
    assert.equal(rows[0]?.status, 'planned')
    assert.equal(rows[0]?.planSha256, receipt.planSha256)
    assert.equal(rows[0]?.inventorySha256, receipt.inventorySha256)
    assert.equal(rows[0]?.independence, 'full')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createCouncilPlanReceipt: independence reduced when no synthesizer', () => {
  const plan: CouncilPlan = {
    version: 1,
    mode: 'probe',
    intent: 'bug-hunt',
    reason: 'single-uncertainty',
    seats: [{ seatId: 'seat-0', objective: 'review', capability: 'text' }],
    crossExamination: false,
    maxCalls: 1,
  }
  const receipt = createCouncilPlanReceipt(plan, [resource()])
  assert.equal(receipt.independence, 'reduced')
})

test('createCouncilPlanReceipt: independence full for mode none', () => {
  const plan: CouncilPlan = {
    version: 1,
    mode: 'none',
    intent: 'bug-hunt',
    reason: 'none-needed',
    seats: [],
    crossExamination: false,
    maxCalls: 0,
  }
  const receipt = createCouncilPlanReceipt(plan, [])
  assert.equal(receipt.independence, 'full')
  assert.equal(receipt.status, 'planned')
  assert.equal(receipt.stage, 'plan')
  assert.equal(receipt.evidence, 'none')
})

test('createCouncilPlanReceipt: produces stable plan and inventory hashes', () => {
  const plan: CouncilPlan = {
    version: 1,
    mode: 'probe',
    intent: 'bug-hunt',
    reason: 'single-uncertainty',
    seats: [{ seatId: 'seat-0', objective: 'review', capability: 'text' }],
    crossExamination: false,
    maxCalls: 1,
  }
  const res = [resource(), resource('sabi-free')]
  const r1 = createCouncilPlanReceipt(plan, res)
  const r2 = createCouncilPlanReceipt(plan, res)
  assert.equal(r1.planSha256, r2.planSha256)
  assert.ok(r1.inventorySha256)
  assert.equal(r1.inventorySha256, r2.inventorySha256)
})

test('createCouncilPlanReceipt: plan hash changes when plan changes', () => {
  const base: CouncilPlan = {
    version: 1,
    mode: 'probe',
    intent: 'bug-hunt',
    reason: 'single-uncertainty',
    seats: [{ seatId: 'seat-0', objective: 'review', capability: 'text' }],
    crossExamination: false,
    maxCalls: 1,
  }
  const r1 = createCouncilPlanReceipt(base, [resource()])
  const r2 = createCouncilPlanReceipt({ ...base, maxCalls: 2 }, [resource()])
  assert.notEqual(r1.planSha256, r2.planSha256)
})
