import { buildShadowRecord, sanitizeShadowRecord } from './shadow.ts'
import { InMemoryShadowStore, countByDivergence, sliceBy } from './shadow-store.ts'
import type { DecisionRecord, RetentionPolicy, ShadowRecord } from './types.ts'

/**
 * Mirror sink for the server (spec 010 T041). It records each completed
 * decision alongside the candidate set the router considered, and it is
 * fail-open by construction: a write problem is counted, never thrown.
 *
 * The sink observes. It never re-routes, never retries, and never blocks a
 * round — the caller has already dispatched by the time it runs.
 */
const ALLOWLISTED_EVIDENCE = new Set<string>([
  'error-line', 'python-traceback', 'panic', 'exception', 'typescript-error', 'fail-marker',
  'command-failed', 'nonzero-exit', 'failure-count', 'command-not-found', 'permission-denied',
  'missing-file', 'soft-warning', 'soft-deprecated', 'soft-retrying', 'soft-timeout', 'tool-error',
  'permission-denial', 'rate-limited', 'quota-exceeded', 'timeout', 'connection-closed', 'mutation',
  'verification-receipt', 'summary-claim', 'scope-observed', 'constraint', 'prior-failure',
  'context-boundary', 'observation',
])

export interface MirrorResult {
  written: number
  dropped: number
  quarantined: number
}

export interface ShadowSinkOptions {
  policy?: RetentionPolicy
  /** Candidate tiers the router could have picked, in preference order. */
  candidates?: (record: DecisionRecord) => DecisionRecord['tier'][]
  /** A proposed alternative tier, when one is worth recording. */
  proposed?: (record: DecisionRecord) => string | undefined
}

export class ShadowMirror {
  private readonly store: InMemoryShadowStore
  private readonly options: ShadowSinkOptions
  private readonly quarantined: { record: unknown; reason: string }[] = []
  private written = 0
  private dropped = 0

  constructor(options: ShadowSinkOptions = {}) {
    this.options = options
    this.store = new InMemoryShadowStore(options.policy)
  }

  /**
   * Observe one completed decision. A rejected record is quarantined with a
   * reason rather than being dropped silently or merged into the corpus.
   */
  observe(record: DecisionRecord): void {
    let mirror: ShadowRecord
    try {
      mirror = sanitizeShadowRecord(this.translate(record))
    } catch (error) {
      this.quarantined.push({
        record,
        reason: error instanceof Error ? error.message : String(error),
      })
      return
    }

    this.written += 1
    const before = this.store.size()
    this.store.push(mirror)
    // Anything the store had to make room for was dropped, and is accounted.
    if (this.store.size() <= before) this.dropped += Math.max(0, before + 1 - this.store.size())
  }

  records(): ShadowRecord[] {
    return this.store.records()
  }

  stats(): MirrorResult & { byDivergence: Record<ShadowRecord['divergence'], number> } {
    return {
      written: this.written,
      dropped: this.dropped,
      quarantined: this.quarantined.length,
      byDivergence: countByDivergence(this.store.records()),
    }
  }

  /** Rejected records with the reason each was quarantined (T021). */
  rejections(): { reason: string }[] {
    return this.quarantined.map((entry) => ({ reason: entry.reason }))
  }

  slice(key: 'tier' | 'rule' | 'outcome'): Map<string, ShadowRecord[]> {
    return sliceBy(this.store.records(), key)
  }

  private proposedFor(record: DecisionRecord): { tier: string; upstream: string; upstreamModel: string }[] {
    const tier = this.options.proposed?.(record)
    if (!tier) return []
    // A proposal that matches the actual route is agreement, not absence; it is
    // recorded so the corpus can distinguish 'agreed' from 'never proposed'.
    return [{ tier, upstream: record.upstream, upstreamModel: record.upstreamModel }]
  }

  /**
   * Translate defensively: a record whose state cannot be normalized is
   * quarantined with a reason instead of being written into the corpus.
   */
  private translate(record: DecisionRecord): ShadowRecord {
    for (const code of record.state?.failureEvidence ?? []) {
      if (!ALLOWLISTED_EVIDENCE.has(code)) {
        throw new Error(`refused unallowlisted evidence code '${String(code)}' in shadow mirror`)
      }
    }
    return buildShadowRecord({
      decision: record,
      proposed: this.proposedFor(record),
      candidates: this.candidatesFor(record),
      state: record.state,
    })
  }

  private candidatesFor(record: DecisionRecord): { tier: string; upstream: string; upstreamModel: string }[] {
    const tiers = this.options.candidates?.(record) ?? []
    return tiers.map((tier) => ({ tier, upstream: record.upstream, upstreamModel: record.upstreamModel }))
  }
}
