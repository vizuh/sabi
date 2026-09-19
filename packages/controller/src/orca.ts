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

export function readOrcaTerminal(handle: string, limit = 200): OrcaCommandResult {
  return runOrcaCommand(['terminal', 'read', '--terminal', handle, '--screen', '--limit', String(limit), '--json'])
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
