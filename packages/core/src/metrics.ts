import type { MetricSeries, MetricSample } from './types.ts'

export interface MetricsSink {
  record(name: string, value: number, labels: Record<string, string>): void
  series(name: string): MetricSeries | undefined
  all(): MetricSeries[]
  reset(): void
}

const BOUNDED_LABEL_KEYS = new Set<string>([
  'tier',
  'upstream',
  'harness',
  'rule',
  'outcome',
  'divergence',
  'kind',
])

/**
 * Operational metrics in OTel/Prometheus shape (spec 010 US2, T030/T031).
 * Labels are bounded and allowlisted — never raw strings, never excerpts.
 * Samples are append-only; the sink is process-local and bounded.
 */
export class InMemoryMetrics implements MetricsSink {
  private readonly buckets = new Map<string, MetricSeries>()
  private readonly maxSamples: number

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples
  }

  record(name: string, value: number, labels: Record<string, string>): void {
    const sanitized = sanitizeLabels(labels)
    const key = `${name}:${JSON.stringify(sanitized)}`
    let entry = this.buckets.get(key)
    if (!entry) {
      entry = { name, unit: '', samples: [] }
      this.buckets.set(key, entry)
    }
    entry.samples.push({ ts: new Date().toISOString(), value, labels: sanitized })
    if (entry.samples.length > this.maxSamples) entry.samples.shift()
  }

  series(name: string): MetricSeries | undefined {
    for (const entry of this.buckets.values()) {
      if (entry.name === name) return entry
    }
    return undefined
  }

  all(): MetricSeries[] {
    return [...this.buckets.values()]
  }

  reset(): void {
    this.buckets.clear()
  }
}

export function sanitizeLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) {
    if (!BOUNDED_LABEL_KEYS.has(key)) continue
    if (typeof value !== 'string') continue
    out[key] = value.slice(0, 64)
  }
  return out
}

/** Derive a bounded metric name from an arbitrary caller label. */
export function metricName(prefix: string, suffix: string): string {
  const cleaned = `${prefix}_${suffix}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
  return cleaned.slice(0, 128)
}