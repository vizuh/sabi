import test from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../src/decide.ts'
import type { ControllerSignals } from '../src/types.ts'

const baseSignals: ControllerSignals = {
  cwd: '/tmp/x',
  requestGiven: true,
  multiScope: false,
  gitClean: true,
  stuckSession: false,
  sabiLogSampled: 5,
  orcaAvailable: false,
  matchingWorktree: false,
  matchingTerminal: false,
}

function signals(patch: Partial<ControllerSignals> = {}): ControllerSignals {
  return { ...baseSignals, ...patch }
}

test('multiScope -> ORCHESTRATE', () => {
  const result = decide(signals({ multiScope: true, multiScopeTrigger: 'flag' }))
  assert.equal(result.action, 'ORCHESTRATE')
  assert.equal(result.rule, 'multi-scope-request')
})

test('stuckSession -> SPAWN', () => {
  const result = decide(signals({ stuckSession: true }))
  assert.equal(result.action, 'SPAWN')
  assert.equal(result.rule, 'stuck-session')
})

test('orca available with a matching worktree -> DELEGATE', () => {
  const result = decide(signals({ orcaAvailable: true, matchingWorktree: true }))
  assert.equal(result.action, 'DELEGATE')
})

test('orca available with a matching terminal -> DELEGATE', () => {
  const result = decide(signals({ orcaAvailable: true, matchingTerminal: true }))
  assert.equal(result.action, 'DELEGATE')
})

test('orca available but no match -> falls through, not DELEGATE', () => {
  const result = decide(signals({ orcaAvailable: true }))
  assert.notEqual(result.action, 'DELEGATE')
})

test('no request, no orca, no log history -> ASK', () => {
  const result = decide(signals({ requestGiven: false, orcaAvailable: false, sabiLogSampled: 0 }))
  assert.equal(result.action, 'ASK')
})

test('ASK requires the full conjunction: any one signal present avoids ASK', () => {
  assert.notEqual(decide(signals({ requestGiven: true, orcaAvailable: false, sabiLogSampled: 0 })).action, 'ASK')
  assert.notEqual(decide(signals({ requestGiven: false, orcaAvailable: true, sabiLogSampled: 0 })).action, 'ASK')
  assert.notEqual(decide(signals({ requestGiven: false, orcaAvailable: false, sabiLogSampled: 1 })).action, 'ASK')
})

test('modal case: dirty tree, clear single-scope request, no other signal -> CONTINUE, not ASK', () => {
  const result = decide(signals({ gitClean: false, requestGiven: true }))
  assert.equal(result.action, 'CONTINUE')
})

test('precedence: multiScope wins over a stuck session', () => {
  const result = decide(signals({ multiScope: true, multiScopeTrigger: 'coordinate', stuckSession: true }))
  assert.equal(result.action, 'ORCHESTRATE')
})

test('precedence: a stuck session wins over an available-but-unmatched orca', () => {
  const result = decide(signals({ stuckSession: true, orcaAvailable: true }))
  assert.equal(result.action, 'SPAWN')
})

test('default CONTINUE reason names the git-clean state without gating on it', () => {
  const clean = decide(signals({ gitClean: true }))
  const dirty = decide(signals({ gitClean: false }))
  assert.equal(clean.action, 'CONTINUE')
  assert.equal(dirty.action, 'CONTINUE')
  assert.match(clean.reason, /git clean: true/)
  assert.match(dirty.reason, /git clean: false/)
})
