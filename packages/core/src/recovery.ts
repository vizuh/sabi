import { defaultLogPath, readDecisions } from './log.ts'
import type { DecisionRecord } from './types.ts'

export interface RecoveryStats {
  recoveries: number
  nonRecoveries: number
}

/** Key: `${tier}::${upstreamModel}`. Internal to this module — never split, only built/looked up
 * through `key()`/`recoveryRate()`; a caller that needs the pairs back should use
 * `recoveryEntries()`, not re-derive a key and split it. */
export type RecoveryProfile = Map<string, RecoveryStats>

export interface RecoveryRate {
  eligible: number
  recoveries: number
  pHat: number
  wilsonLower: number
  wilsonUpper: number
}

// ponytail: a floor against acting on a handful of samples, not a derived statistic — the Wilson
// bound below is what does the real statistical work.
const MIN_SAMPLE = 30
const Z = 1.6449 // one-sided 95%: the question is "at least as good", not "what's the range".

function key(tier: string, upstreamModel: string): string {
  return `${tier}::${upstreamModel}`
}

/** A row whose `state` is missing or not a failure-carrying object cannot be paired. */
function isUsableState(state: unknown): state is { failure: string; contextGeneration?: number } {
  return typeof state === 'object' && state !== null &&
    typeof (state as { failure?: unknown }).failure === 'string'
}

/**
 * A recovery event: round `i` in a session had `state.failure === 'hard'` (the round that got
 * classified into the `failure` policy rule in the first place), and round `i`'s action is
 * credited with whether round `i+1` in that same session came back clean. Recovery credit
 * belongs to `i`, not `i+1` — `i+1`'s state describes the *result* of `i`'s action.
 *
 * `state.failure`, not `state.failureStreak`, is the trigger: `failureStreak`/`repeatedFailure`
 * are hardcoded to `0`/`false` in `extractTrajectoryState()` (`state.ts`) — the proxy path is
 * stateless across requests and never tracks a cross-round streak. Only the Class A mod computes
 * a real streak (`harness.ts`), and the mod never calls Jev. `state.failure` is what the proxy
 * *does* compute correctly per round, and it's exactly the signal that put the round in the
 * `failure` rule to begin with.
 *
 * Pairing is by **adjacent position in the full per-session sequence, including non-`'ok'`
 * rows** — an intervening `error`/`aborted`/`transport` round breaks adjacency; it is not
 * silently dropped from the sequence, which would let two rounds that were never actually
 * consecutive get paired together. Excluded (neither recovery nor non-recovery), not counted
 * either way:
 * - a session's trailing round with no successor (censored, not observed)
 * - either side of the pair is not `outcome === 'ok'` (can't trust its state, or it's not a
 *   genuine two-round-apart observation)
 * - a pair straddling a host compaction (`contextGeneration` differs) — not a model outcome
 * - a pair where the successor's failure is `'transport'` — a provider/proxy failure, not one
 *   caused by round `i`'s model
 *
 * Reads only structured fields already in `DecisionRecord`/`TrajectoryState` (tier, upstreamModel,
 * sessionId/sessionKnown, outcome, state.failure/.contextGeneration) — never `reason` or
 * `failureEvidence`, the only free-text-adjacent fields, so there is nothing here for
 * `telemetry.ts`'s allowlist to gate.
 */
export function computeRecovery(records: readonly DecisionRecord[]): RecoveryProfile {
  const profile: RecoveryProfile = new Map()
  const bySession = new Map<string, DecisionRecord[]>()
  for (const record of records) {
    if (record.sessionKnown !== true) continue
    // A line that parses but lacks a usable session identity carries no pairing signal —
    // skip it rather than grouping unrelated rows under one key.
    if (typeof record.sessionId !== 'string' || !record.sessionId) continue
    const bucket = bySession.get(record.sessionId)
    if (bucket) bucket.push(record)
    else bySession.set(record.sessionId, [record])
  }

  for (const session of bySession.values()) {
    for (let i = 0; i < session.length - 1; i++) {
      const current = session[i]!
      const next = session[i + 1]!
      if (current.outcome !== 'ok' || next.outcome !== 'ok') continue
      // A structurally incomplete row (valid JSON, missing `state`) is skipped like a
      // malformed line — it must never disable the profile for the whole process.
      if (!isUsableState(current.state) || !isUsableState(next.state)) continue
      if (typeof current.tier !== 'string' || typeof current.upstreamModel !== 'string') continue
      if (current.state.failure !== 'hard') continue
      if (current.state.contextGeneration !== next.state.contextGeneration) continue
      if (next.state.failure === 'transport') continue

      const k = key(current.tier, current.upstreamModel)
      const stats = profile.get(k) ?? { recoveries: 0, nonRecoveries: 0 }
      if (next.state.failure === 'none') stats.recoveries++
      else stats.nonRecoveries++
      profile.set(k, stats)
    }
  }
  return profile
}

export function loadRecovery(logFile = defaultLogPath()): RecoveryProfile {
  return computeRecovery(readDecisions(logFile))
}

/** Raw stats regardless of the sample gate — for diagnostics (e.g. "n=12 < 30"), never for a
 * routing decision, which must always go through `recoveryRate()`'s gate. */
export function recoveryStats(profile: RecoveryProfile, tier: string, upstreamModel: string): RecoveryStats | undefined {
  return profile.get(key(tier, upstreamModel))
}

/** Undefined below `MIN_SAMPLE` eligible pairs — the gate lives here once. */
export function recoveryRate(profile: RecoveryProfile, tier: string, upstreamModel: string): RecoveryRate | undefined {
  const stats = profile.get(key(tier, upstreamModel))
  if (!stats) return undefined
  const eligible = stats.recoveries + stats.nonRecoveries
  if (eligible < MIN_SAMPLE) return undefined
  const pHat = stats.recoveries / eligible
  const center = (pHat + (Z * Z) / (2 * eligible)) / (1 + (Z * Z) / eligible)
  const margin = (Z / (1 + (Z * Z) / eligible)) * Math.sqrt(pHat * (1 - pHat) / eligible + (Z * Z) / (4 * eligible * eligible))
  return { eligible, recoveries: stats.recoveries, pHat, wilsonLower: center - margin, wilsonUpper: center + margin }
}

/** Every `(tier, upstreamModel)` pair the profile has any data for, decoded without ever
 * splitting a joined string — avoids the delimiter-collision risk of reconstructing and
 * splitting a `tier::model` key by hand. */
export function recoveryPairs(profile: RecoveryProfile): Array<{ tier: string; upstreamModel: string }> {
  const pairs: Array<{ tier: string; upstreamModel: string }> = []
  for (const k of profile.keys()) {
    const sep = k.indexOf('::')
    pairs.push({ tier: k.slice(0, sep), upstreamModel: k.slice(sep + 2) })
  }
  return pairs
}

/**
 * The single decline predicate, shared by `judge.ts` (production) and `backtest.ts`
 * (measurement) so they can never silently drift apart. A non-overlapping-confidence-interval
 * test: the candidate's worst credible rate must exceed the incumbent's *best* credible rate —
 * strictly more conservative than comparing either side's point estimate, which would let a
 * noisy small-sample incumbent look beatable when it might not be.
 */
export function candidateBeatsIncumbent(candidate: RecoveryRate | undefined, incumbent: RecoveryRate | undefined): boolean {
  return Boolean(candidate && incumbent && candidate.wilsonLower > incumbent.wilsonUpper)
}
