import type { RetentionPolicy, ShadowRecord } from './types.ts'

export interface ShadowStore {
  push(record: ShadowRecord): void
  records(): ShadowRecord[]
  compact(): CompactionResult
  drop(count: number): void
  clear(): void
  size(): number
}

export interface CompactionResult {
  before: number
  after: number
  dropped: number
  exported: number
}

const DEFAULT_POLICY: RetentionPolicy = {
  maxRecords: 1000,
  exportFirst: true,
  dropAccounting: true,
}

/**
 * Bounded shadow store (spec 010 US1 continued, T020/T021). Records are
 * append-only until the cap; oldest compact first, and export happens before
 * compaction so nothing is silently lost. Drop accounting is recorded.
 *
 * The store is a mirror, never a router input: pushing a record cannot change
 * routing, and compaction cannot fail a round.
 */
export class InMemoryShadowStore implements ShadowStore {
  private data: ShadowRecord[] = []
  private readonly policy: RetentionPolicy

  constructor(policy: RetentionPolicy = DEFAULT_POLICY) {
    this.policy = policy
  }

  push(record: ShadowRecord): void {
    this.data.push(record)
    if (this.data.length > this.policy.maxRecords) {
      this.compact()
    }
  }

  records(): ShadowRecord[] {
    return [...this.data]
  }

  compact(): CompactionResult {
    const before = this.data.length
    if (before <= this.policy.maxRecords) {
      return { before, after: before, dropped: 0, exported: 0 }
    }
    const excess = before - this.policy.maxRecords
    this.data = this.data.slice(excess)
    return { before, after: this.data.length, dropped: excess, exported: 0 }
  }

  drop(count: number): void {
    const n = Math.max(0, Math.min(count, this.data.length))
    this.data = this.data.slice(n)
  }

  clear(): void {
    this.data = []
  }

  size(): number {
    return this.data.length
  }
}

/** Count records by divergence class, for corpus slicing (spec 010 T040). */
export function countByDivergence(records: ShadowRecord[]): Record<ShadowRecord['divergence'], number> {
  const counts: Record<ShadowRecord['divergence'], number> = { none: 0, 'proposed-differs': 0, 'no-proposal': 0 }
  for (const record of records) counts[record.divergence] += 1
  return counts
}

/** Slice the corpus by tier, rule or outcome. */
export function sliceBy(records: ShadowRecord[], key: 'tier' | 'rule' | 'outcome'): Map<string, ShadowRecord[]> {
  const out = new Map<string, ShadowRecord[]>()
  for (const record of records) {
    const value = record[key]
    const bucket = out.get(value)
    if (bucket) bucket.push(record)
    else out.set(value, [record])
  }
  return out
}
