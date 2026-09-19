import { spawnSync } from 'node:child_process'
import type { OrcaErrorCode, OrcaQueryResult } from './types.ts'

const DEFAULT_TIMEOUT_MS = 3000

export function orcaBin(): string {
  return process.env.ORCA_CLI_COMMAND?.trim() || 'orca-ide'
}

/**
 * One subcommand call. Always fail-open: any failure returns `{ok:false, errorCode}`, never
 * throws — Orca is an external, third-party binary that may not even be installed, and a
 * documented lifecycle-reporting bug (2026-08-03 postmortem) means its output must be treated as
 * best-effort, never a hard dependency for a routing decision.
 */
export function runOrca(args: string[], opts: { bin?: string; timeoutMs?: number } = {}): OrcaQueryResult {
  const bin = opts.bin ?? orcaBin()
  const result = spawnSync(bin, args, { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, encoding: 'utf8' })

  // Check error.code explicitly before falling through to a generic branch — checking
  // result.error truthiness first would mislabel a timeout as a missing binary.
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    return { ok: false, errorCode: 'binary-not-found' }
  }
  if (result.signal) return { ok: false, errorCode: 'timeout' }
  if (result.error) return { ok: false, errorCode: 'binary-not-found' }
  if (result.status !== 0) return { ok: false, errorCode: 'nonzero-exit' }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { ok: false, errorCode: 'invalid-json' }
  }

  // Shape is NOT verified against a real orca-ide install in this pass — TODO: confirm the real
  // `orca-ide worktree ps --json` / `terminal list --json` field names before trusting this.
  // `unrecognized-shape` stays its own code, distinct from "queried fine, found nothing", so a
  // parse-shape bug can never be silently read as "no match" in signals.ts.
  if (!Array.isArray(parsed)) return { ok: false, errorCode: 'unrecognized-shape' }
  return { ok: true, worktrees: parsed }
}

export function queryOrcaWorktrees(opts?: { bin?: string; timeoutMs?: number }): OrcaQueryResult {
  return runOrca(['worktree', 'ps', '--json'], opts)
}

export function queryOrcaTerminals(opts?: { bin?: string; timeoutMs?: number }): OrcaQueryResult {
  return runOrca(['terminal', 'list', '--json'], opts)
}
