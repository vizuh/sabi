import { performance } from 'node:perf_hooks'
import type { DecisionRecord, EpisodeEvidenceSource, ProfileCandidate, SemanticEpisode, TrajectoryState } from './types.ts'

export type ProfileConfidence = 'low' | 'medium' | 'high'

export interface SemanticProfile {
  key: string
  operation: string
  model?: string
  harness?: string
  samples: number
  recovered: number
  failed: number
  incomplete: number
  unknown: number
  verified: number
  coverageSamples: number
  coverageMean?: number
  costKnown: number
  totalCost?: number
  latencyKnown: number
  averageLatencyMs?: number
  evidence: Record<EpisodeEvidenceSource, number>
  confidence: ProfileConfidence
}

export interface ProfileOptions {
  maxProfiles?: number
  highConfidenceSamples?: number
}

const DEFAULT_MAX_PROFILES = 256
const DEFAULT_HIGH_CONFIDENCE_SAMPLES = 30
function bounded(value: string | undefined, max = 160): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined
}

function profileKey(episode: SemanticEpisode): string {
  return [episode.operation, episode.model ?? '', episode.harness ?? ''].join('\u001f')
}

function confidence(samples: number, high: number): ProfileConfidence {
  if (samples >= high) return 'high'
  if (samples >= Math.max(3, Math.ceil(high / 3))) return 'medium'
  return 'low'
}

interface MutableProfile {
  key: string
  operation: string
  model?: string
  harness?: string
  samples: number
  recovered: number
  failed: number
  incomplete: number
  unknown: number
  verified: number
  coverageSamples: number
  coverageTotal: number
  costKnown: number
  totalCost: number
  latencyKnown: number
  latencyTotal: number
  evidence: Record<EpisodeEvidenceSource, number>
}

function emptyEvidence(): Record<EpisodeEvidenceSource, number> {
  return { fixture: 0, 'source-test': 0, ci: 0, 'live-runtime': 0 }
}

/** Aggregate bounded local evidence; this is reporting data and never changes active routing. */
export function aggregateSemanticProfiles(
  episodes: readonly SemanticEpisode[],
  options: ProfileOptions = {},
): SemanticProfile[] {
  const maxProfiles = Math.max(1, Math.floor(options.maxProfiles ?? DEFAULT_MAX_PROFILES))
  const highConfidenceSamples = Math.max(3, Math.floor(options.highConfidenceSamples ?? DEFAULT_HIGH_CONFIDENCE_SAMPLES))
  const profiles = new Map<string, MutableProfile>()

  for (const episode of episodes) {
    const operation = bounded(episode.operation) ?? 'unknown'
    const normalized: SemanticEpisode = { ...episode, operation }
    const key = profileKey(normalized)
    let profile = profiles.get(key)
    if (!profile) {
      if (profiles.size >= maxProfiles) continue
      profile = {
        key,
        operation,
        ...(bounded(episode.model) ? { model: bounded(episode.model) } : {}),
        ...(bounded(episode.harness) ? { harness: bounded(episode.harness) } : {}),
        samples: 0,
        recovered: 0,
        failed: 0,
        incomplete: 0,
        unknown: 0,
        verified: 0,
        coverageSamples: 0,
        coverageTotal: 0,
        costKnown: 0,
        totalCost: 0,
        latencyKnown: 0,
        latencyTotal: 0,
        evidence: emptyEvidence(),
      }
      profiles.set(key, profile)
    }

    profile.samples += 1
    if (episode.result === 'recovered') profile.recovered += 1
    else if (episode.result === 'failed') profile.failed += 1
    else if (episode.result === 'incomplete') profile.incomplete += 1
    else profile.unknown += 1
    if (episode.verification?.status === 'passed') profile.verified += 1
    if (typeof episode.coverage?.ratio === 'number' && Number.isFinite(episode.coverage.ratio)) {
      profile.coverageSamples += 1
      profile.coverageTotal += Math.max(0, Math.min(1, episode.coverage.ratio))
    }
    if (typeof episode.cost === 'number' && Number.isFinite(episode.cost) && episode.cost >= 0) {
      profile.costKnown += 1
      profile.totalCost += episode.cost
    }
    if (typeof episode.latencyMs === 'number' && Number.isFinite(episode.latencyMs) && episode.latencyMs >= 0) {
      profile.latencyKnown += 1
      profile.latencyTotal += episode.latencyMs
    }
    profile.evidence[episode.evidence] += 1
  }

  return [...profiles.values()]
    .sort((a, b) => b.samples - a.samples || a.key.localeCompare(b.key))
    .map((profile) => ({
      key: profile.key,
      operation: profile.operation,
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.harness ? { harness: profile.harness } : {}),
      samples: profile.samples,
      recovered: profile.recovered,
      failed: profile.failed,
      incomplete: profile.incomplete,
      unknown: profile.unknown,
      verified: profile.verified,
      coverageSamples: profile.coverageSamples,
      ...(profile.coverageSamples > 0 ? { coverageMean: profile.coverageTotal / profile.coverageSamples } : {}),
      costKnown: profile.costKnown,
      ...(profile.costKnown > 0 ? { totalCost: profile.totalCost } : {}),
      latencyKnown: profile.latencyKnown,
      ...(profile.latencyKnown > 0 ? { averageLatencyMs: profile.latencyTotal / profile.latencyKnown } : {}),
      evidence: profile.evidence,
      confidence: confidence(profile.samples, highConfidenceSamples),
    }))
}

function stateOf(record: DecisionRecord): TrajectoryState | undefined {
  const value = record.state
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/** Convert a privacy-filtered decision row into local semantic evidence for reporting. */
export function semanticEpisodeFromDecision(record: DecisionRecord): SemanticEpisode {
  const state = stateOf(record)
  const result = record.outcome === 'ok' ? 'recovered' : record.outcome === 'error' || record.outcome === 'aborted' ? 'failed' : 'unknown'
  return {
    operation: state?.roundKind ?? record.rule ?? 'unknown',
    taskClass: record.rule,
    phase: 'live',
    ...(record.upstreamModel ? { model: record.upstreamModel.slice(0, 160) } : {}),
    result,
    ...(state?.verification ? { verification: state.verification } : {}),
    ...(state?.scopeCoverage ? { coverage: state.scopeCoverage } : {}),
    ...(record.recovery ? { recovery: record.recovery } : {}),
    ...(record.usage ? { usage: record.usage } : {}),
    ...(record.cost?.total !== undefined ? { cost: record.cost.total } : {}),
    ...(record.latencyMs !== undefined ? { latencyMs: record.latencyMs } : {}),
    evidence: 'live-runtime',
  }
}

export interface CandidateInput {
  id: string
  operation: string
  model?: string
  harness?: string
  episodes: readonly SemanticEpisode[]
  minimumSamples?: number
}

/** Create an inert candidate. It is always shadow until an explicit backtest gate runs. */
export function proposeProfileCandidate(input: CandidateInput): ProfileCandidate {
  const operation = bounded(input.operation) ?? 'unknown'
  const model = bounded(input.model)
  const harness = bounded(input.harness)
  const minimumSamples = Math.max(1, Math.floor(input.minimumSamples ?? 3))
  const sampleCount = input.episodes.filter((episode) =>
    episode.operation === operation && (!model || episode.model === model) && (!harness || episode.harness === harness),
  ).length
  return {
    id: bounded(input.id, 128) ?? 'candidate',
    operation,
    ...(model ? { model } : {}),
    ...(harness ? { harness } : {}),
    sampleCount,
    minimumSamples,
    status: 'shadow',
  }
}

export function backtestProfileCandidate(
  candidate: ProfileCandidate,
  result: { passed: boolean; holdoutPassed?: boolean; reason?: string },
): ProfileCandidate {
  return {
    ...candidate,
    status: result.passed ? 'backtested' : 'rejected',
    backtest: {
      passed: result.passed,
      ...(result.holdoutPassed !== undefined ? { holdoutPassed: result.holdoutPassed } : {}),
      ...(result.reason ? { reason: result.reason.slice(0, 240) } : {}),
    },
  }
}

/** Promotion is explicit and gated; callers must choose whether to activate a candidate. */
export function promoteProfileCandidate(candidate: ProfileCandidate): ProfileCandidate {
  const gated = candidate.status === 'backtested' && candidate.sampleCount >= candidate.minimumSamples && candidate.backtest?.passed === true && candidate.backtest.holdoutPassed === true
  return gated ? { ...candidate, status: 'active' } : { ...candidate, status: 'rejected', backtest: { ...candidate.backtest, passed: false, reason: 'promotion-gate-failed' } }
}

export function rollbackProfileCandidate(candidate: ProfileCandidate, reference: string): ProfileCandidate {
  return { ...candidate, status: 'rolled-back', rollbackReference: reference.slice(0, 160) }
}

export interface ProfileBenchmark {
  iterations: number
  inputEpisodes: number
  profileCount: number
  elapsedMs: number
  bounded: boolean
}

/** Deterministic local benchmark used to catch unbounded profile growth, not a quality claim. */
export function benchmarkSemanticProfiles(episodes: readonly SemanticEpisode[], iterations = 10): ProfileBenchmark {
  const count = Math.max(1, Math.floor(iterations))
  const started = performance.now()
  let profiles: SemanticProfile[] = []
  for (let i = 0; i < count; i += 1) profiles = aggregateSemanticProfiles(episodes)
  return {
    iterations: count,
    inputEpisodes: episodes.length,
    profileCount: profiles.length,
    elapsedMs: Math.max(0, performance.now() - started),
    bounded: profiles.length <= DEFAULT_MAX_PROFILES,
  }
}
