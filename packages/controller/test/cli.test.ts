import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  const result = run(['please', 'fix', 'this', 'carefully', '--json'], cwd)
  assert.equal(result.status, 0)
  const record = JSON.parse(result.stdout)
  assert.equal(record.action, 'ASK')
  assert.equal(record.request, 'please fix this carefully')
})

test('--orchestrate forces ORCHESTRATE regardless of request text', () => {
  const cwd = workspace()
  const result = run(['a single simple fix', '--orchestrate', '--json'], cwd)
  assert.equal(result.status, 0)
  const record = JSON.parse(result.stdout)
  assert.equal(record.action, 'ASK')
  assert.equal(record.rule, 'no-orchestration-target')
})

test('a recent hard-failure row with no Orca -> ASK rather than pretending to spawn', () => {
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
  assert.equal(JSON.parse(result.stdout).action, 'ASK')
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

test('human-readable output reports execution state and never crashes without --json', () => {
  const cwd = workspace()
  const result = run(['fix the bug'], cwd)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /\[CONTROLLER\]/)
  assert.match(result.stdout, /execution: awaiting-user/)
})

test('the real CLI exposes status and agents as read-only machine inventory commands', () => {
  const cwd = workspace()
  const status = run(['status', '--json'], cwd)
  assert.equal(status.status, 0)
  const statusRecord = JSON.parse(status.stdout)
  assert.equal(statusRecord.cwd, cwd)
  assert.equal(statusRecord.runtime.mode, 'local-cli')
  assert.equal(statusRecord.runtime.daemon, 'not-configured')
  assert.equal(statusRecord.orca.available, false)

  const agents = run(['agents', '--json'], cwd)
  assert.equal(agents.status, 0)
  const agentsRecord = JSON.parse(agents.stdout)
  assert.equal(agentsRecord.active.id, statusRecord.active.id)
  assert.equal(agentsRecord.active.lifecycle, statusRecord.active.lifecycle)
  assert.equal(agentsRecord.active.capacity.status, statusRecord.active.capacity.status)
})

test('route remains an explicit alias and logs can be read without exposing a daemon claim', () => {
  const cwd = workspace()
  const routed = run(['route', 'read', 'this', '--json'], cwd)
  assert.equal(routed.status, 0)
  assert.equal(JSON.parse(routed.stdout).request, 'read this')

  const logs = run(['logs', '--tail=1', '--json'], cwd)
  assert.equal(logs.status, 0)
  const record = JSON.parse(logs.stdout)
  assert.equal(record.records.length, 1)
  assert.equal(record.records[0].request, 'read this')
})

test('doctor and config report local boundaries without reading secrets', () => {
  const cwd = workspace()
  const doctor = run(['doctor', '--json'], cwd)
  assert.equal(doctor.status, 0)
  const doctorRecord = JSON.parse(doctor.stdout)
  assert.equal(doctorRecord.runtime.daemon, 'not-configured')
  assert.equal(doctorRecord.checks.some((check: { name: string }) => check.name === 'node'), true)

  const config = run(['config', '--json'], cwd)
  assert.equal(config.status, 0)
  const configRecord = JSON.parse(config.stdout)
  assert.equal(configRecord.cwd, cwd)
  assert.match(configRecord.controllerLogPath, /controller-decisions\.jsonl$/)
})

test('setup writes user-level preferences without pretending to install harness hooks', () => {
  const cwd = workspace()
  const stateDir = path.join(cwd, 'controller-state')
  const setup = run(['setup', '--no-start', '--json'], cwd, { SABI_CONTROLLER_HOME: stateDir })
  assert.equal(setup.status, 0)
  const record = JSON.parse(setup.stdout)
  assert.equal(record.stateDir, stateDir)
  assert.equal(record.automaticRouting, true)
  assert.equal(record.daemon, 'stopped')
  assert.equal(record.integrations, 'not-installed')
  assert.equal(existsSync(record.preferencesPath), true)

  const status = run(['status', '--json'], cwd, { SABI_CONTROLLER_HOME: stateDir })
  assert.equal(status.status, 0)
  assert.equal(JSON.parse(status.stdout).runtime.daemon, 'stopped')
})

test('setup --hooks installs all host bridges in isolated config paths', () => {
  const cwd = workspace()
  const stateDir = path.join(cwd, 'controller-state')
  const setup = run(['setup', '--no-start', '--hooks', '--json'], cwd, {
    SABI_CONTROLLER_HOME: stateDir,
    SABI_CLAUDE_SETTINGS: path.join(cwd, 'claude', 'settings.json'),
    SABI_CODEX_HOOKS: path.join(cwd, 'codex', 'hooks.json'),
    SABI_OPENCODE_CONFIG: path.join(cwd, 'opencode', 'opencode.json'),
    SABI_HOOK_COMMAND: 'sabi-test',
  })
  assert.equal(setup.status, 0)
  const record = JSON.parse(setup.stdout)
  assert.deepEqual(record.hooks.map((hook: { harness: string }) => hook.harness), ['claude', 'codex', 'opencode'])
  assert.equal(existsSync(path.join(cwd, 'claude', 'settings.json')), true)
  assert.equal(existsSync(path.join(cwd, 'codex', 'hooks.json')), true)
  assert.equal(existsSync(path.join(cwd, 'opencode', 'opencode.json')), true)
})
