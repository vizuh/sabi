import { spawnSync } from 'node:child_process'
import type { OrcaErrorCode, OrcaQueryResult } from './types.ts'

const DEFAULT_TIMEOUT_MS = 3000

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
  const bin = opts.bin ?? orcaBin()
  const field = opts.field ?? 'worktrees'
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

  // Real shape, observed live against orca-ide 1.4.201 on 2026-09-19 (not a published, stable
  // contract — orca-ide is third-party; re-verify against `orca-ide --version` if this ever stops
  // matching): `{ id, ok, result: { worktrees: [...] } }` / `{ id, ok, result: { terminals: [...] } }`,
  // NOT a bare array. `unrecognized-shape` stays its own code, distinct from "queried fine, found
  // nothing", so an envelope drift can never be silently read as "no match" in signals.ts.
  const envelope = parsed as { ok?: unknown; result?: Record<string, unknown> } | null
  if (typeof envelope !== 'object' || envelope === null || envelope.ok !== true) {
    return { ok: false, errorCode: 'unrecognized-shape' }
  }
  const items = envelope.result?.[field]
  if (!Array.isArray(items)) return { ok: false, errorCode: 'unrecognized-shape' }
  return { ok: true, [field]: items }
}

export function queryOrcaWorktrees(opts?: { bin?: string; timeoutMs?: number }): OrcaQueryResult {
  return runOrca(['worktree', 'ps', '--json'], { ...opts, field: 'worktrees' })
}

export function queryOrcaTerminals(opts?: { bin?: string; timeoutMs?: number }): OrcaQueryResult {
  return runOrca(['terminal', 'list', '--json'], { ...opts, field: 'terminals' })
}
