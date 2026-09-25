import { spawnSync } from 'node:child_process'
import type { OrcaErrorCode, OrcaQueryResult } from './types.ts'

const DEFAULT_TIMEOUT_MS = 3000
const ACTION_TIMEOUT_MS = 30_000

export interface OrcaCommandResult {
  ok: boolean
  id?: string
  result?: unknown
  errorCode?: OrcaErrorCode
  detail?: string
}

export interface OrcaTerminalSendReceipt {
  requestId?: string
  inputAccepted?: boolean
  turnStarted?: boolean
}

export interface OrcaTerminalWaitReceipt {
  handle?: string
  condition?: string
  satisfied?: boolean
  status?: string
  exitCode?: number | null
}

export interface OrcaTerminalReadReceipt {
  terminal: {
    handle?: string
    status?: string
    tail: string[]
  }
  oldestCursor?: string | number
  nextCursor?: string | number
  latestCursor?: string | number
  returnedLineCount?: number
  source?: string
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function numberOrCursor(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  return undefined
}

function nestedObject(root: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return objectValue(root[key])
}

/** Parse only the terminal-send receipt fields exposed at the command result root. */
export function parseTerminalSendReceipt(value: unknown): OrcaTerminalSendReceipt | undefined {
  const root = objectValue(value)
  if (!root) return undefined
  const receipt = nestedObject(root, 'receipt') ?? root
  const requestId = stringValue(receipt.requestId) ?? stringValue(receipt.request_id)
  const inputAccepted = booleanValue(receipt.inputAccepted) ?? booleanValue(receipt.input_accepted) ?? booleanValue(receipt.accepted)
  const turnStarted = booleanValue(receipt.turnStarted) ?? booleanValue(receipt.turn_started)
  if (requestId === undefined && inputAccepted === undefined && turnStarted === undefined) return undefined
  return {
    ...(requestId ? { requestId } : {}),
    ...(inputAccepted !== undefined ? { inputAccepted } : {}),
    ...(turnStarted !== undefined ? { turnStarted } : {}),
  }
}

/** Parse the known `{wait:{...}}` result; unknown envelopes stay unverifiable. */
export function parseTerminalWaitReceipt(value: unknown): OrcaTerminalWaitReceipt | undefined {
  const root = objectValue(value)
  if (!root) return undefined
  const wait = nestedObject(root, 'wait')
  if (!wait) return undefined
  const handle = stringValue(wait.handle)
  const condition = stringValue(wait.condition)
  const satisfied = booleanValue(wait.satisfied)
  const status = stringValue(wait.status)
  const exitCode = wait.exitCode === null ? null : typeof wait.exitCode === 'number' && Number.isFinite(wait.exitCode) ? wait.exitCode : undefined
  if (handle === undefined && condition === undefined && satisfied === undefined && status === undefined && exitCode === undefined) return undefined
  return {
    ...(handle ? { handle } : {}),
    ...(condition ? { condition } : {}),
    ...(satisfied !== undefined ? { satisfied } : {}),
    ...(status ? { status } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  }
}

/** Parse the observed terminal screen and its explicit cursor fields. */
export function parseTerminalReadReceipt(value: unknown): OrcaTerminalReadReceipt | undefined {
  const root = objectValue(value)
  if (!root) return undefined
  const terminal = nestedObject(root, 'terminal')
  const tail = terminal?.tail
  if (!terminal || !Array.isArray(tail) || tail.some((line) => typeof line !== 'string')) return undefined
  const returnedLineCount = root.returnedLineCount
  return {
    terminal: {
      ...(stringValue(terminal.handle) ? { handle: stringValue(terminal.handle) } : {}),
      ...(stringValue(terminal.status) ? { status: stringValue(terminal.status) } : {}),
      tail: tail as string[],
    },
    ...(numberOrCursor(root.oldestCursor) !== undefined ? { oldestCursor: numberOrCursor(root.oldestCursor) } : {}),
    ...(numberOrCursor(root.nextCursor) !== undefined ? { nextCursor: numberOrCursor(root.nextCursor) } : {}),
    ...(numberOrCursor(root.latestCursor) !== undefined ? { latestCursor: numberOrCursor(root.latestCursor) } : {}),
    ...(typeof returnedLineCount === 'number' && Number.isSafeInteger(returnedLineCount) && returnedLineCount >= 0 ? { returnedLineCount } : {}),
    ...(stringValue(root.source) ? { source: stringValue(root.source) } : {}),
  }
}

export function parseCreatedTerminalResult(value: unknown): { handle: string } | undefined {
  const root = objectValue(value)
  const handle = root ? stringValue(root.handle) ?? stringValue(nestedObject(root, 'terminal')?.handle) : undefined
  return handle ? { handle } : undefined
}

export function parseCreatedRunResult(value: unknown): { runId: string } | undefined {
  const root = objectValue(value)
  const runId = root ? stringValue(root.runId) ?? stringValue(root.run_id) ?? stringValue(root.id) : undefined
  return runId ? { runId } : undefined
}

export function parseStartedWorkerResult(value: unknown): { dispatchId: string } | undefined {
  const root = objectValue(value)
  const dispatchId = root ? stringValue(root.dispatchId) ?? stringValue(root.dispatch_id) ?? stringValue(root.id) : undefined
  return dispatchId ? { dispatchId } : undefined
}

export function parseWorkerStatusResult(value: unknown): { status?: string } | undefined {
  const root = objectValue(value)
  if (!root) return undefined
  const worker = nestedObject(root, 'worker')
  const status = stringValue(root.status) ?? stringValue(root.state) ?? stringValue(worker?.status) ?? stringValue(worker?.state)
  return status ? { status } : undefined
}

export function orcaBin(): string {
  return process.env.ORCA_CLI_COMMAND?.trim() || 'orca-ide'
}

/**
 * One subcommand call. Always fail-open: any failure returns `{ok:false, errorCode}`, never
 * throws — Orca is an external, third-party binary that may not even be installed, and a
 * documented lifecycle-reporting bug (`context/Hugo OS/postmortems/2026-08-03-orca-br-skill-legacy-read-only.md`,
 * sourced against `stablyai/orca#12034`/`#11993`/`#10406`/`#11582`) means its output must be
 * treated as best-effort, never a hard dependency for a routing decision.
 */
export function runOrca(
  args: string[],
  opts: { bin?: string; timeoutMs?: number; field?: 'worktrees' | 'terminals' } = {},
): OrcaQueryResult {
  const result = runOrcaCommand(args, opts)
  if (!result.ok) return result

  const envelope = result.result as Record<string, unknown> | undefined
  const items = envelope?.[opts.field ?? 'worktrees']
  if (!Array.isArray(items)) return { ok: false, errorCode: 'unrecognized-shape' }
  return { ok: true, [opts.field ?? 'worktrees']: items }
}

/** Run a mutating or read-only Orca command and retain only its structured result. */
export function runOrcaCommand(
  args: string[],
  opts: { bin?: string; timeoutMs?: number } = {},
): OrcaCommandResult {
  const bin = opts.bin ?? orcaBin()
  const result = spawnSync(bin, args, { timeout: opts.timeoutMs ?? ACTION_TIMEOUT_MS, encoding: 'utf8' })

  // Check error.code explicitly before falling through to a generic branch — checking
  // result.error truthiness first would mislabel a timeout as a missing binary.
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    return { ok: false, errorCode: 'binary-not-found' }
  }
  if (result.signal) return { ok: false, errorCode: 'timeout' }
  if (result.error) return { ok: false, errorCode: 'binary-not-found' }
  if (result.status !== 0) {
    const detail = result.stderr.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 300)
    return { ok: false, errorCode: 'nonzero-exit', ...(detail ? { detail } : {}) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { ok: false, errorCode: 'invalid-json' }
  }

  // Real shape, observed live against orca-ide 1.4.201 on 2026-09-19 (not a published, stable
  // contract — orca-ide is third-party; re-verify against `orca-ide --version` if this ever stops
  // matching): `{ id, ok, result: ... }`, not a bare array. An envelope drift never becomes a
  // false "no match".
  const envelope = parsed as { id?: unknown; ok?: unknown; result?: unknown } | null
  if (typeof envelope !== 'object' || envelope === null || envelope.ok !== true) {
    return { ok: false, errorCode: 'unrecognized-shape' }
  }
  return {
    ok: true,
    id: typeof envelope.id === 'string' ? envelope.id : undefined,
    result: envelope.result,
  }
}

export function queryOrcaWorktrees(opts?: { bin?: string; timeoutMs?: number }): OrcaQueryResult {
  const result = runOrcaCommand(['worktree', 'ps', '--json'], opts)
  if (!result.ok) return result
  const items = (result.result as Record<string, unknown> | undefined)?.worktrees
  return Array.isArray(items) ? { ok: true, worktrees: items } : { ok: false, errorCode: 'unrecognized-shape' }
}

export function queryOrcaTerminals(opts?: { bin?: string; timeoutMs?: number }): OrcaQueryResult {
  const result = runOrcaCommand(['terminal', 'list', '--json'], opts)
  if (!result.ok) return result
  const items = (result.result as Record<string, unknown> | undefined)?.terminals
  return Array.isArray(items) ? { ok: true, terminals: items } : { ok: false, errorCode: 'unrecognized-shape' }
}

export function sendOrcaTerminal(handle: string, text: string, opts: { timeoutMs?: number; waitSubmitSeconds?: number } = {}): OrcaCommandResult {
  return runOrcaCommand(
    [
      'terminal',
      'send',
      '--terminal',
      handle,
      '--text',
      text,
      '--enter',
      '--wait-submit',
      String(opts.waitSubmitSeconds ?? 5),
      '--json',
    ],
    { timeoutMs: opts.timeoutMs ?? ACTION_TIMEOUT_MS },
  )
}

export function createOrcaTerminal(
  worktree: string,
  command: string,
  title: string,
  opts: { timeoutMs?: number } = {},
): OrcaCommandResult {
  return runOrcaCommand(
    ['terminal', 'create', '--worktree', `path:${worktree}`, '--title', title, '--command', command, '--json'],
    { timeoutMs: opts.timeoutMs ?? ACTION_TIMEOUT_MS },
  )
}

export function closeOrcaTerminal(handle: string, opts: { timeoutMs?: number } = {}): OrcaCommandResult {
  return runOrcaCommand(
    ['terminal', 'close', '--terminal', handle, '--json'],
    { timeoutMs: opts.timeoutMs ?? ACTION_TIMEOUT_MS },
  )
}

export function waitOrcaTerminal(
  handle: string,
  condition: 'exit' | 'tui-idle' = 'tui-idle',
  timeoutMs = 5000,
): OrcaCommandResult {
  return runOrcaCommand(
    ['terminal', 'wait', '--terminal', handle, '--for', condition, '--timeout-ms', String(timeoutMs), '--json'],
    { timeoutMs: timeoutMs + 1000 },
  )
}

export function readOrcaTerminal(handle: string, limit = 200, opts: { timeoutMs?: number } = {}): OrcaCommandResult {
  return runOrcaCommand(['terminal', 'read', '--terminal', handle, '--screen', '--limit', String(limit), '--json'], opts)
}

export function createOrcaRun(objective: string, from?: string): OrcaCommandResult {
  const args = ['orchestration', 'run-create', '--objective', objective]
  if (from) args.push('--from', from)
  args.push('--json')
  return runOrcaCommand(args)
}

export function startOrcaWorker(options: {
  runId?: string
  spec: string
  agent: string
  repo: string
  name: string
  baseBranch?: string
}): OrcaCommandResult {
  const args = [
    'orchestration',
    'worker-start',
    '--spec',
    options.spec,
    '--worktree',
    'new-child',
    '--agent',
    options.agent,
    '--repo',
    `path:${options.repo}`,
    '--name',
    options.name,
  ]
  if (options.baseBranch) args.push('--base-branch', options.baseBranch)
  if (options.runId) args.push('--run', options.runId)
  args.push('--json')
  return runOrcaCommand(args, { timeoutMs: 60_000 })
}

export function showOrcaWorker(dispatchId: string): OrcaCommandResult {
  return runOrcaCommand(['orchestration', 'worker-show', '--dispatch', dispatchId, '--json'])
}
