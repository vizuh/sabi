import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gatherSignals } from '../src/signals.ts'

const baseState = {
  messageCount: 4,
  assistantTurns: 1,
  toolMessages: 1,
  lastRole: 'tool',
  contextChars: 100,
  estimatedTokens: 100,
  hasTools: true,
  toolNames: [] as string[],
  lastToolNames: [] as string[],
  roundKind: 'verification' as const,
  failure: 'none' as const,
  failureEvidence: [] as string[],
}

function decisionRow(patch: { ts: string; failure: 'none' | 'soft' | 'hard'; outcome?: 'ok' | 'error' }): string {
  return JSON.stringify({
    ts: patch.ts,
    sessionId: 's1',
    alias: 'sabi-code',
    mode: 'auto',
    rule: 'failure',
    tier: 'strong',
    reason: 'x',
    upstream: 'openrouter',
    upstreamModel: 'm-strong',
    stream: false,
    outcome: patch.outcome ?? 'ok',
    state: { ...baseState, failure: patch.failure },
  })
}

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-signals-'))
}

function writeLog(cwd: string, lines: string[]): void {
  const dir = path.join(cwd, '.sabi')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'decisions.jsonl'), `${lines.join('\n')}\n`)
}

/** A one-off orca-ide stand-in emitting the real, observed envelope shape
 * (`{ ok, result: { worktrees/terminals: [...] } }`), reporting the given cwd as its one entry. */
function fakeOrca(matchCwd: string | null): string {
  const scriptDir = mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-fake-orca-'))
  const scriptPath = path.join(scriptDir, 'orca-ide.js')
  const entry = matchCwd ? JSON.stringify({ path: matchCwd, worktreePath: matchCwd, branch: '' }) : 'null'
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node\nconst entry = ${entry}\nconsole.log(JSON.stringify({ id: 'x', ok: true, result: { worktrees: entry ? [entry] : [], terminals: entry ? [entry] : [] } }))\n`,
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

// Isolate from both the real environment's SABI_LOG (would override --cwd) and any real
// orca-ide install on this machine (would make orcaAvailable non-deterministic).
const savedSabiLog = process.env.SABI_LOG
const savedOrcaCmd = process.env.ORCA_CLI_COMMAND
test.beforeEach(() => {
  delete process.env.SABI_LOG
  process.env.ORCA_CLI_COMMAND = '/nonexistent/sabi-test-orca-binary'
})
test.after(() => {
  if (savedSabiLog === undefined) delete process.env.SABI_LOG
  else process.env.SABI_LOG = savedSabiLog
  if (savedOrcaCmd === undefined) delete process.env.ORCA_CLI_COMMAND
  else process.env.ORCA_CLI_COMMAND = savedOrcaCmd
})

test('git-clean: a freshly initialized repo with no changes reports true', () => {
  const cwd = workspace()
  spawnSync('git', ['init', '--quiet'], { cwd })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd })
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.gitClean, true)
})

test('git-clean: an untracked file reports false', () => {
  const cwd = workspace()
  spawnSync('git', ['init', '--quiet'], { cwd })
  writeFileSync(path.join(cwd, 'file.txt'), 'x')
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.gitClean, false)
})

test('git-clean: not a git repo reports undefined, not a crash', () => {
  const cwd = workspace()
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.gitClean, undefined)
})

test('stuck session: a recent hard-failure row as the last entry -> stuck true', () => {
  const cwd = workspace()
  writeLog(cwd, [decisionRow({ ts: new Date().toISOString(), failure: 'hard' })])
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, true)
  assert.equal(signals.sabiLogSampled, 1)
})

test('stuck session: a recent clean row as the last entry -> stuck false', () => {
  const cwd = workspace()
  writeLog(cwd, [
    decisionRow({ ts: new Date().toISOString(), failure: 'hard' }),
    decisionRow({ ts: new Date().toISOString(), failure: 'none' }),
  ])
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, false)
  assert.equal(signals.sabiLogSampled, 2)
})

test('stuck session: a hard-failure row older than the recency window is not stuck', () => {
  const cwd = workspace()
  const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString()
  writeLog(cwd, [decisionRow({ ts: stale, failure: 'hard' })])
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, false)
  assert.equal(signals.sabiLogSampled, 0)
})

test('stuck session: a recent row missing state entirely does not crash, reports not stuck', () => {
  const cwd = workspace()
  const malformed = JSON.stringify({ ts: new Date().toISOString(), outcome: 'ok' })
  writeLog(cwd, [malformed])
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, false)
  assert.equal(signals.sabiLogSampled, 1)
})

test('stuck session: a recent row with state: null does not crash, reports not stuck', () => {
  const cwd = workspace()
  const malformed = JSON.stringify({ ts: new Date().toISOString(), outcome: 'ok', state: null })
  writeLog(cwd, [malformed])
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, false)
  assert.equal(signals.sabiLogSampled, 1)
})

test('stuck session: a top-level non-object row (null/number/array/string) does not crash, not sampled', () => {
  for (const row of ['null', '42', '[]', '"a string"']) {
    const cwd = workspace()
    writeLog(cwd, [row])
    const signals = gatherSignals(cwd, 'do something', false)
    assert.equal(signals.stuckSession, false, `row=${row}`)
    assert.equal(signals.sabiLogSampled, 0, `row=${row}`)
  }
})

test('stuck session: a row with a non-string ts does not crash, is not sampled', () => {
  const cwd = workspace()
  writeLog(cwd, [JSON.stringify({ ts: 12345, outcome: 'ok', state: { failure: 'hard' } })])
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, false)
  assert.equal(signals.sabiLogSampled, 0)
})

test('stuck session: no log file -> not stuck, zero sampled', () => {
  const cwd = workspace()
  const signals = gatherSignals(cwd, 'do something', false)
  assert.equal(signals.stuckSession, false)
  assert.equal(signals.sabiLogSampled, 0)
})

test('multi-scope: --orchestrate flag always wins regardless of request text', () => {
  const cwd = workspace()
  const signals = gatherSignals(cwd, 'a single simple fix', true)
  assert.equal(signals.multiScope, true)
  assert.equal(signals.multiScopeTrigger, 'flag')
})

test('multi-scope: keyword heuristic fires on an allowlisted phrase', () => {
  const cwd = workspace()
  const signals = gatherSignals(cwd, 'please coordinate this across projects', false)
  assert.equal(signals.multiScope, true)
  assert.equal(signals.multiScopeTrigger, 'across-projects')
})

test('multi-scope: no flag, no keyword hit -> false', () => {
  const cwd = workspace()
  const signals = gatherSignals(cwd, 'fix the login bug', false)
  assert.equal(signals.multiScope, false)
  assert.equal(signals.multiScopeTrigger, undefined)
})

test('orca unavailable (missing binary) never crashes and reports orcaAvailable false', () => {
  const cwd = workspace()
  const signals = gatherSignals(cwd, 'fix the login bug', false)
  assert.equal(signals.orcaAvailable, false)
  assert.equal(signals.orcaErrorCode, 'binary-not-found')
  assert.equal(signals.matchingWorktree, false)
  assert.equal(signals.matchingTerminal, false)
})

test('orca available, a worktree/terminal already on this exact cwd -> matchingWorktree/matchingTerminal true', () => {
  const cwd = workspace()
  process.env.ORCA_CLI_COMMAND = fakeOrca(cwd)
  const signals = gatherSignals(cwd, 'fix the login bug', false)
  assert.equal(signals.orcaAvailable, true)
  assert.equal(signals.matchingWorktree, true)
  assert.equal(signals.matchingTerminal, true)
})

test('orca available but no entry matches this cwd -> no match, DELEGATE stays unreachable', () => {
  const cwd = workspace()
  const otherCwd = workspace()
  process.env.ORCA_CLI_COMMAND = fakeOrca(otherCwd)
  const signals = gatherSignals(cwd, 'fix the login bug', false)
  assert.equal(signals.orcaAvailable, true)
  assert.equal(signals.matchingWorktree, false)
  assert.equal(signals.matchingTerminal, false)
})
