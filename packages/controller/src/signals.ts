import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { readDecisions } from '@sabi/core'
import { queryOrcaTerminals, queryOrcaWorktrees } from './orca.ts'
import type { AgentInventory } from './inventory.ts'
import type { ControllerSignals, MultiScopeKeyword } from './types.ts'

// ponytail: recency proxy for "current session" — no live session identity exists anywhere in
// Sabi today (DecisionRecord.sessionId is a post-hoc analytics grouping, not a live registry).
// A real 550-row backtest on this machine found zero sessionKnown:true rows, so gating this on
// sessionKnown (like recovery.ts does) would make the stuck-session signal permanently dead.
// Upgrade to a real session filter once live session identity exists.
const STALE_AFTER_MS = 30 * 60 * 1000

const MULTI_SCOPE_KEYWORDS: Array<{ id: MultiScopeKeyword; pattern: RegExp }> = [
  { id: 'multiple-projects', pattern: /\bmultiple projects\b/i },
  { id: 'multiple-repos', pattern: /\bmultiple (repos|repositories)\b/i },
  { id: 'across-projects', pattern: /\bacross (projects|repos)\b/i },
  { id: 'coordinate', pattern: /\bcoordinate\b/i },
  { id: 'orchestrate', pattern: /\borchestrate\b/i },
]

function gitClean(cwd: string): boolean | undefined {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'], // a non-repo cwd is an expected case, not worth git's stderr noise
    })
    return out.trim().length === 0
  } catch {
    return undefined // not a git repo, git missing, or the call errored — genuinely unknown
  }
}

/** Mirrors `@sabi/core`'s `defaultLogPath()` `SABI_LOG` precedence, but against the requested
 * cwd rather than `process.cwd()` — `defaultLogPath()` itself can't be reused as-is because
 * `--cwd` may differ from the controller process's own working directory. */
function inferenceLogPath(cwd: string): string {
  return process.env.SABI_LOG?.trim() || path.join(cwd, '.sabi', 'decisions.jsonl')
}

/** `readDecisions()` only guards unparsable JSON lines, not row shape — a literal `null` line, a
 * bare number, or a partially-written row from a crashed writer all parse fine but aren't a
 * usable record. Filtered out once, here, rather than guarding each property access downstream —
 * a prior fix patched only `last.state.failure` and missed that `r.ts` a few lines above has the
 * exact same hazard on the exact same unvalidated input. */
function isPlainRecord(row: unknown): row is Record<string, unknown> {
  return typeof row === 'object' && row !== null && !Array.isArray(row)
}

export interface StuckSessionSignal {
  stuck: boolean
  sampled: number
}

export function stuckSessionSignal(cwd: string): StuckSessionSignal {
  // Cast to unknown[] first so `.filter(isPlainRecord)` actually narrows the element type —
  // filtering a DecisionRecord[] with this predicate type-checks but doesn't narrow, since
  // Record<string, unknown> isn't a subtype of DecisionRecord (it has no index signature).
  const rows = (readDecisions(inferenceLogPath(cwd)) as unknown[]).filter(isPlainRecord)
  const cutoff = Date.now() - STALE_AFTER_MS
  const recent = rows.filter((r) => typeof r.ts === 'string' && new Date(r.ts).getTime() >= cutoff)
  const last = recent.at(-1)
  const stuck = Boolean(last?.outcome === 'ok' && isPlainRecord(last?.state) && last.state.failure === 'hard')
  return { stuck, sampled: recent.length }
}

function detectMultiScope(
  requestText: string | undefined,
  forced: boolean,
): { multiScope: boolean; trigger?: 'flag' | MultiScopeKeyword } {
  if (forced) return { multiScope: true, trigger: 'flag' }
  if (!requestText) return { multiScope: false }
  const hit = MULTI_SCOPE_KEYWORDS.find((k) => k.pattern.test(requestText))
  return hit ? { multiScope: true, trigger: hit.id } : { multiScope: false }
}

/** Narrows one array entry to "has a non-empty string at `field`" without claiming to know
 * orca-ide's full entry shape — only the one field this predicate actually reads. */
function stringField(entry: unknown, field: string): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const value = (entry as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Path-only match, deliberately not branch-aware: a live query against orca-ide 1.4.201 on
 * 2026-09-19 observed `branch: ""` on real worktree/terminal entries, so branch is not a reliable
 * signal today. Compares `path.resolve()`'d paths, not realpath — a match can miss across a
 * symlinked mount; accepted as a best-effort signal, same spirit as the recency-based
 * stuck-session gate above. */
function matchesCwd(entries: unknown[] | undefined, field: string, cwd: string): boolean {
  if (!entries) return false
  return entries.some((entry) => {
    const value = stringField(entry, field)
    return value !== undefined && path.resolve(value) === cwd
  })
}

export function gatherSignals(
  cwd: string,
  requestText: string | undefined,
  orchestrateFlag: boolean,
  inventory?: AgentInventory,
  sampledStuck?: StuckSessionSignal,
): ControllerSignals {
  const { multiScope, trigger } = detectMultiScope(requestText, orchestrateFlag)
  const { stuck, sampled } = sampledStuck ?? stuckSessionSignal(cwd)
  const worktrees = inventory ? undefined : queryOrcaWorktrees()
  const terminals = inventory ? undefined : queryOrcaTerminals()
  const orcaAvailable = inventory?.orcaAvailable ?? Boolean(worktrees?.ok || terminals?.ok)
  const matchingWorktree = inventory?.matchingWorktree ?? Boolean(worktrees?.ok && matchesCwd(worktrees.worktrees, 'path', cwd))
  const matchingTerminal = inventory?.matchingTerminal ?? Boolean(terminals?.ok && matchesCwd(terminals.terminals, 'worktreePath', cwd))

  return {
    cwd,
    requestGiven: Boolean(requestText),
    multiScope,
    multiScopeTrigger: trigger,
    gitClean: gitClean(cwd),
    stuckSession: stuck,
    sabiLogSampled: sampled,
    orcaAvailable,
    orcaErrorCode: orcaAvailable ? undefined : inventory?.errorCode ?? worktrees?.errorCode ?? terminals?.errorCode,
    matchingWorktree,
    matchingTerminal,
  }
}
