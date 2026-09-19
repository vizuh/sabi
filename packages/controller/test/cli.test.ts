import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sabi-controller-cli-'))
}

function run(args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, SABI_LOG: undefined, ORCA_CLI_COMMAND: '/nonexistent/sabi-test-orca-binary', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
}

function decisionsLog(cwd: string): string {
  return path.join(cwd, '.sabi', 'controller-decisions.jsonl')
}

test('no request, no history, no orca -> ASK, one well-formed log line, exit 0', () => {
  const cwd = workspace()
  const result = run(['--json'], cwd)
  assert.equal(result.status, 0)
  const record = JSON.parse(result.stdout)
  assert.equal(record.action, 'ASK')

  const lines = readFileSync(decisionsLog(cwd), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]!).action, 'ASK')
})

test('an unquoted multi-word request is joined, not truncated to its first token', () => {
  const cwd = workspace()
  const result = run(['please', 'coordinate', 'this', 'across', 'projects', '--json'], cwd)
  assert.equal(result.status, 0)
  const record = JSON.parse(result.stdout)
  assert.equal(record.action, 'ORCHESTRATE')
  assert.equal(record.signals.multiScopeTrigger, 'across-projects')
})

test('--orchestrate forces ORCHESTRATE regardless of request text', () => {
  const cwd = workspace()
  const result = run(['a single simple fix', '--orchestrate', '--json'], cwd)
  assert.equal(result.status, 0)
  const record = JSON.parse(result.stdout)
  assert.equal(record.action, 'ORCHESTRATE')
})

test('a recent hard-failure row in .sabi/decisions.jsonl -> SPAWN', () => {
  const cwd = workspace()
  mkdirSync(path.join(cwd, '.sabi'), { recursive: true })
  const row = {
    ts: new Date().toISOString(),
    sessionId: 's1',
    alias: 'sabi-code',
    mode: 'auto',
    rule: 'failure',
    tier: 'strong',
    reason: 'x',
    upstream: 'openrouter',
    upstreamModel: 'm-strong',
    stream: false,
    outcome: 'ok',
    state: {
      messageCount: 4,
      assistantTurns: 1,
      toolMessages: 1,
      lastRole: 'tool',
      contextChars: 100,
      estimatedTokens: 100,
      hasTools: true,
      toolNames: [],
      lastToolNames: [],
      roundKind: 'verification',
      failure: 'hard',
      failureEvidence: [],
    },
  }
  writeFileSync(path.join(cwd, '.sabi', 'decisions.jsonl'), `${JSON.stringify(row)}\n`)

  const result = run(['fix the bug', '--json'], cwd)
  assert.equal(JSON.parse(result.stdout).action, 'SPAWN')
})

test('the same stuck-session row, backdated past the recency window -> not SPAWN', () => {
  const cwd = workspace()
  mkdirSync(path.join(cwd, '.sabi'), { recursive: true })
  const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString()
  const row = {
    ts: staleTs,
    sessionId: 's1',
    alias: 'sabi-code',
    mode: 'auto',
    rule: 'failure',
    tier: 'strong',
    reason: 'x',
    upstream: 'openrouter',
    upstreamModel: 'm-strong',
    stream: false,
    outcome: 'ok',
    state: {
      messageCount: 4,
      assistantTurns: 1,
      toolMessages: 1,
      lastRole: 'tool',
      contextChars: 100,
      estimatedTokens: 100,
      hasTools: true,
      toolNames: [],
      lastToolNames: [],
      roundKind: 'verification',
      failure: 'hard',
      failureEvidence: [],
    },
  }
  writeFileSync(path.join(cwd, '.sabi', 'decisions.jsonl'), `${JSON.stringify(row)}\n`)

  const result = run(['fix the bug', '--json'], cwd)
  assert.notEqual(JSON.parse(result.stdout).action, 'SPAWN')
})

test('human-readable output prints the advisory-only disclaimer and never crashes without --json', () => {
  const cwd = workspace()
  const result = run(['fix the bug'], cwd)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /\[CONTROLLER\]/)
  assert.match(result.stdout, /advisory only/)
})
