import type { SabiConfig, UpstreamEntry } from './types.ts'

export interface UpstreamHealth {
  name: string
  ok: boolean
  /** Epoch ms of the last probe. Absent when never probed. */
  lastProbe?: number
  /** Consecutive failures; resets to zero on a successful probe. */
  failures: number
  /** HTTP status of the last probe, when one was recorded. */
  lastStatus?: number
  /** Bounded error message, when the probe failed. */
  lastError?: string
}

export interface HealthMonitorOptions {
  intervalMs?: number
  /** Failures before an upstream is marked down. */
  downThreshold?: number
  fetchImpl?: typeof fetch
}

/**
 * Live upstream health monitor (spec 010 US2, T030/T031). Probes each
 * configured upstream on a fixed cadence and exposes a bounded snapshot.
 * A dead upstream is skipped by the router until it returns, so a downed
 * Hermes proxy stops producing 502s. This is availability evidence, never
 * quality or entitlement evidence.
 */
export class HealthMonitor {
  private readonly config: SabiConfig
  private readonly onTick: () => void
  private readonly intervalMs: number
  private readonly downThreshold: number
  private readonly fetchImpl: typeof fetch
  private readonly state = new Map<string, UpstreamHealth>()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(config: SabiConfig, onTick: () => void, options: HealthMonitorOptions = {}) {
    this.config = config
    this.onTick = onTick
    this.intervalMs = options.intervalMs ?? 30_000
    this.downThreshold = options.downThreshold ?? 3
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  start(): void {
    if (this.timer) return
    this.probeAll()
    this.timer = setInterval(() => this.probeAll(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  snapshot(): UpstreamHealth[] {
    return [...this.state.values()]
  }

  isUp(name: string): boolean {
    const entry = this.state.get(name)
    return !entry || entry.ok
  }

  private async probeAll(): Promise<void> {
    for (const [name, upstream] of Object.entries(this.config.upstreams ?? {})) {
      await this.probe(name, upstream)
    }
    this.onTick()
  }

  private async probe(name: string, upstream: UpstreamEntry): Promise<void> {
    const previous = this.state.get(name) ?? { name, ok: true, failures: 0 }
    let next: UpstreamHealth
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      const response = await this.fetchImpl(`${upstream.baseURL.replace(/\/$/, '')}/healthz`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (response.ok) {
        next = { name, ok: true, lastProbe: Date.now(), failures: 0, lastStatus: response.status }
      } else {
        next = {
          name,
          ok: previous.failures + 1 >= this.downThreshold,
          lastProbe: Date.now(),
          failures: previous.failures + 1,
          lastStatus: response.status,
        }
      }
    } catch (error) {
      next = {
        name,
        ok: previous.failures + 1 >= this.downThreshold,
        lastProbe: Date.now(),
        failures: previous.failures + 1,
        lastError: error instanceof Error ? error.message.slice(0, 128) : String(error),
      }
    }
    this.state.set(name, next)
  }
}