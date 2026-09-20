import type { HarnessModelHealth } from './types.ts'

const HEALTH_TTL_MS = 60_000

interface ModelHealthEntry extends HarnessModelHealth {
  harness: string
  model: string
}

const entries = new Map<string, ModelHealthEntry>()

function publicHealth(entry: ModelHealthEntry): HarnessModelHealth {
  const { harness: _harness, model: _model, ...health } = entry
  return health
}

function key(harness: string, model: string): string {
  return `${harness}\0${model}`
}

function valid(value: string): string {
  return value.trim().slice(0, 160)
}

export function modelHealth(harness: string, model: string, now = Date.now()): HarnessModelHealth | undefined {
  const entry = entries.get(key(harness, model))
  if (!entry) return undefined
  if (now - entry.observedAt > HEALTH_TTL_MS) {
    entries.delete(key(harness, model))
    return undefined
  }
  return publicHealth(entry)
}

export function recordModelReceipt(input: {
  harness: string
  model: string
  outcome: HarnessModelHealth['lastOutcome']
  latencyMs?: number
  observedAt?: number
}): HarnessModelHealth {
  const harness = valid(input.harness)
  const model = valid(input.model)
  const observedAt = input.observedAt ?? Date.now()
  const previous = entries.get(key(harness, model))
  const health: ModelHealthEntry = {
    harness,
    model,
    status: input.outcome === 'failed' ? 'unavailable' : input.outcome === 'ok' ? 'healthy' : 'unknown',
    sampleCount: (previous?.sampleCount ?? 0) + 1,
    successCount: (previous?.successCount ?? 0) + (input.outcome === 'ok' ? 1 : 0),
    failureCount: (previous?.failureCount ?? 0) + (input.outcome === 'failed' ? 1 : 0),
    lastOutcome: input.outcome,
    ...(typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) && input.latencyMs >= 0
      ? { lastLatencyMs: Math.round(input.latencyMs) }
      : {}),
    observedAt,
  }
  entries.set(key(harness, model), health)
  return publicHealth(health)
}

export function clearModelHealth(): void {
  entries.clear()
}
