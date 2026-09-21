import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { hasSensitivePath } from './surplus.ts'
import { looksLikeCanary } from './telemetry.ts'
import type { SurplusResource } from './surplus.ts'

export type CouncilMode = 'none' | 'probe' | 'panel' | 'debate' | 'council'
export type CouncilStage = 'plan' | 'review' | 'cross-examination' | 'synthesis' | 'verification'
export type CouncilReceiptStatus = 'planned' | 'started' | 'completed' | 'failed' | 'unavailable' | 'unverified'
export type CouncilEvidenceLevel = 'none' | 'transport' | 'execution' | 'completion' | 'verification'
export type CouncilReceiptSource = 'live' | 'mock' | 'simulated'
export type CouncilIntent = 'bug-hunt' | 'test-gap' | 'api-contract' | 'architecture' | 'security' | 'quality' | 'other'
export type CouncilPlanReason = 'none-needed' | 'single-uncertainty' | 'independent-risks' | 'conflicting-claims' | 'high-consequence' | 'unsure'
export type CouncilIndependence = 'full' | 'reduced'

export interface CouncilSeat {
  seatId: string
  objective: string
  capability: string
  harness?: string
  provider?: string
  model?: string
}

export interface CouncilPlan {
  version: 1
  mode: CouncilMode
  intent: CouncilIntent
  reason: CouncilPlanReason
  seats: CouncilSeat[]
  crossExamination: boolean
  synthesizer?: Pick<CouncilSeat, 'harness' | 'provider' | 'model'>
  maxCalls: number
}

/**
 * Plan fields that are recorded as a hash on the ledger so the stored plan
 * cannot be silently replaced by a later mutable catalog claim.
 */
interface CouncilPlanSummary {
  version: 1
  mode: CouncilMode
  intent: CouncilIntent
  reason: CouncilPlanReason
  seats: Array<{ objective: string; capability: string }>
  crossExamination: boolean
  synthesizer?: Pick<CouncilSeat, 'harness' | 'provider' | 'model'>
  maxCalls: number
}

export interface CouncilLedgerReceipt {
  version: 1
  receiptId: string
  ts: string
  taskKey?: string
  harness: string
  runtimeVersion?: string
  provider?: string
  model?: string
  seatId?: string
  stage: CouncilStage
  mode: CouncilMode
  intent: CouncilIntent
  status: CouncilReceiptStatus
  evidence: CouncilEvidenceLevel
  source: CouncilReceiptSource
  independence: CouncilIndependence
  planSha256?: string
  inventorySha256?: string
  inputSha256?: string
  outputSha256?: string
  claimCount: number
  verifiedClaimCount: number
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  transportStatus?: number
  errorCode?: string
}

export interface CouncilPreGateInput {
  intent: CouncilIntent
  mode: CouncilMode
  maxCalls: number
  changedFiles?: string[]
  diff?: string
  resources?: SurplusResource[]
}

export type CouncilPreGateResult =
  | { ok: true; reason: 'viable'; note?: string }
  | { ok: false; reason: 'sensitive-paths' | 'secret-marker' | 'no-resource' | 'budget-exceeded' | 'no-uncertainty' }

const MODES = new Set<CouncilMode>(['none', 'probe', 'panel', 'debate', 'council'])
const STAGES = new Set<CouncilStage>(['plan', 'review', 'cross-examination', 'synthesis', 'verification'])
const STATUSES = new Set<CouncilReceiptStatus>(['planned', 'started', 'completed', 'failed', 'unavailable', 'unverified'])
const EVIDENCE = new Set<CouncilEvidenceLevel>(['none', 'transport', 'execution', 'completion', 'verification'])
const SOURCES = new Set<CouncilReceiptSource>(['live', 'mock', 'simulated'])
const INTENTS = new Set<CouncilIntent>(['bug-hunt', 'test-gap', 'api-contract', 'architecture', 'security', 'quality', 'other'])
const INDEPENDENCE = new Set<CouncilIndependence>(['full', 'reduced'])
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/
const SHA256 = /^[a-f0-9]{64}$/i

function label(value: string | undefined): string | undefined {
  if (!value) return undefined
  const candidate = value.trim()
  return LABEL.test(candidate) ? candidate : undefined
}

function sha256(value: string | undefined): string | undefined {
  if (!value) return undefined
  const candidate = value.trim()
  return SHA256.test(candidate) ? candidate.toLowerCase() : undefined
}

function count(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value))
}

function optionalCount(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : count(value)
}

function httpStatus(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
}

function boundedError(value: string | undefined): string | undefined {
  return label(value)?.slice(0, 80)
}

export function councilHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function defaultCouncilLedgerPath(): string {
  return process.env.SABI_COUNCIL_LOG?.trim() || path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'), 'sabi', 'council-ledger.jsonl')
}

/**
 * Serialize the deterministic subset of a plan for hashing. Seat
 * metadata (harness/provider/model) is excluded so the hash binds
 * the plan's structure, not a mutable provider catalog.
 */
function planSummary(plan: CouncilPlan): CouncilPlanSummary {
  return {
    version: plan.version,
    mode: plan.mode,
    intent: plan.intent,
    reason: plan.reason,
    seats: plan.seats.map((s) => ({ objective: s.objective, capability: s.capability })),
    crossExamination: plan.crossExamination,
    ...(plan.synthesizer ? { synthesizer: plan.synthesizer } : {}),
    maxCalls: plan.maxCalls,
  }
}

/**
 * Serialize the zero-cost resource inventory for hashing. Only the
 * alias/provider/model triple is recorded so the hash is stable
 * across runs while still binding available capacity.
 */
function inventorySummary(resources: SurplusResource[] | undefined): Array<{ alias: string; provider: string; model: string }> {
  return (resources ?? []).map((r) => ({ alias: r.alias, provider: r.provider, model: r.model }))
}

export function newCouncilLedgerReceipt(input: {
  taskKey?: string
  harness: string
  runtimeVersion?: string
  provider?: string
  model?: string
  seatId?: string
  stage: CouncilStage
  mode: CouncilMode
  intent: CouncilIntent
  status: CouncilReceiptStatus
  evidence: CouncilEvidenceLevel
  source: CouncilReceiptSource
  independence?: CouncilIndependence
  planSha256?: string
  inventorySha256?: string
  inputSha256?: string
  outputSha256?: string
  claimCount?: number
  verifiedClaimCount?: number
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  transportStatus?: number
  errorCode?: string
  now?: Date
}): CouncilLedgerReceipt {
  const claimCount = count(input.claimCount)
  const verifiedClaimCount = input.evidence === 'verification'
    ? Math.min(claimCount, count(input.verifiedClaimCount))
    : 0
  const taskKey = label(input.taskKey)
  const runtimeVersion = label(input.runtimeVersion)
  const provider = label(input.provider)
  const model = label(input.model)
  const seatId = label(input.seatId)
  const planSha256 = sha256(input.planSha256)
  const inventorySha256 = sha256(input.inventorySha256)
  const inputSha256 = sha256(input.inputSha256)
  const outputSha256 = sha256(input.outputSha256)
  const inputTokens = optionalCount(input.inputTokens)
  const outputTokens = optionalCount(input.outputTokens)
  const latencyMs = optionalCount(input.latencyMs)
  const transportStatus = httpStatus(input.transportStatus)
  const errorCode = boundedError(input.errorCode)
  return {
    version: 1,
    receiptId: randomUUID(),
    ts: (input.now ?? new Date()).toISOString(),
    ...(taskKey ? { taskKey } : {}),
    harness: label(input.harness) ?? 'unknown',
    ...(runtimeVersion ? { runtimeVersion } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(seatId ? { seatId } : {}),
    stage: STAGES.has(input.stage) ? input.stage : 'review',
    mode: MODES.has(input.mode) ? input.mode : 'probe',
    intent: INTENTS.has(input.intent) ? input.intent : 'other',
    status: STATUSES.has(input.status) ? input.status : 'unverified',
    evidence: EVIDENCE.has(input.evidence) ? input.evidence : 'none',
    source: SOURCES.has(input.source) ? input.source : 'simulated',
    independence: INDEPENDENCE.has(input.independence as CouncilIndependence)
      ? (input.independence as CouncilIndependence)
      : 'full',
    ...(planSha256 ? { planSha256 } : {}),
    ...(inventorySha256 ? { inventorySha256 } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(outputSha256 ? { outputSha256 } : {}),
    claimCount,
    verifiedClaimCount,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(transportStatus === undefined ? {} : { transportStatus }),
    ...(errorCode ? { errorCode } : {}),
  }
}

/**
 * Known receipt fields in canonical write order.
 * appendCouncilLedgerReceipt serializes only these keys, so unknown
 * or injected fields (rawPrompt, credentials, etc.) never persist to
 * the JSONL ledger.
 */
const RECEIPT_KEYS: ReadonlyArray<keyof CouncilLedgerReceipt> = [
  'version', 'receiptId', 'ts', 'taskKey', 'harness', 'runtimeVersion', 'provider',
  'model', 'seatId', 'stage', 'mode', 'intent', 'status', 'evidence', 'source',
  'independence', 'planSha256', 'inventorySha256', 'inputSha256', 'outputSha256',
  'claimCount', 'verifiedClaimCount', 'inputTokens', 'outputTokens', 'latencyMs',
  'transportStatus', 'errorCode',
]

export function appendCouncilLedgerReceipt(receipt: CouncilLedgerReceipt, logFile = defaultCouncilLedgerPath()): void {
  mkdirSync(path.dirname(logFile), { recursive: true })
  const sanitized: Record<string, unknown> = {}
  for (const key of RECEIPT_KEYS) {
    if (receipt[key] !== undefined) sanitized[key as string] = receipt[key]
  }
  appendFileSync(logFile, `${JSON.stringify(sanitized)}\n`)
}

export function readCouncilLedgerReceipts(logFile = defaultCouncilLedgerPath()): CouncilLedgerReceipt[] {
  if (!existsSync(logFile)) return []
  const rows: CouncilLedgerReceipt[] = []
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      if (record.version !== 1 || typeof record.receiptId !== 'string' || typeof record.harness !== 'string') continue
      if (!MODES.has(record.mode as CouncilMode) || !STAGES.has(record.stage as CouncilStage)) continue
      if (!INTENTS.has(record.intent as CouncilIntent) || !STATUSES.has(record.status as CouncilReceiptStatus)) continue
      if (!EVIDENCE.has(record.evidence as CouncilEvidenceLevel) || !SOURCES.has(record.source as CouncilReceiptSource)) continue
      rows.push(value as CouncilLedgerReceipt)
    } catch {
      // Ignore a torn or malformed receipt; the next write remains append-only.
    }
  }
  return rows
}

/**
 * Minimum number of provider calls the given mode requires (lower bound).
 * The spec defines mode budgets as ceilings, not targets; this enforces that
 * a plan never reserves fewer calls than the mode's minimum footprint.
 */
export function minCallsForMode(mode: CouncilMode): number {
  switch (mode) {
    case 'none': return 0
    case 'probe': return 1
    case 'panel': return 2
    case 'debate': return 2
    case 'council': return 3
  }
}

/** Heuristic: a public GitHub remote suggests the scope is public rather than private.
 * Deterministic via `git remote -v`; fail-open to false when git is unavailable. */
function isPublicGithubRemote(cwd: string): boolean {
  try {
    const output = execFileSync('git', ['remote', '-v'], {
      cwd, encoding: 'utf8', timeout: 2000, maxBuffer: 64_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return /github\.com\/[^\s/]+\/[^\s/]+(?:\.git)?\s+\(fetch\)/i.test(output)
  } catch {
    return false
  }
}

/**
 * Deterministic pre-gates for a surplus council (Phase 1): sensitive paths,
 * public/synthetic scope, available zero-cost resource, and per-request call
 * budget. Returns ok=true with a note for public scope; returns ok=false with
 * a reason for any hard block. Does not execute a model call.
 */
export function councilPreGate(input: CouncilPreGateInput, cwd?: string): CouncilPreGateResult {
  if (input.mode === 'none') return { ok: true, reason: 'viable' }

  const files = input.changedFiles?.map((file) => file.trim()).filter(Boolean) ?? []

  if (files.length > 0 && hasSensitivePath(files)) return { ok: false, reason: 'sensitive-paths' }
  if (input.diff && looksLikeCanary(input.diff)) return { ok: false, reason: 'secret-marker' }

  if (cwd && isPublicGithubRemote(cwd)) {
    return { ok: true, reason: 'viable', note: 'public-scope' }
  }

  if (!input.resources || input.resources.length === 0) return { ok: false, reason: 'no-resource' }

  if (minCallsForMode(input.mode) > input.maxCalls) return { ok: false, reason: 'budget-exceeded' }

  if (files.length === 0 && (!input.diff || !input.diff.trim())) {
    return { ok: false, reason: 'no-uncertainty' }
  }

  return { ok: true, reason: 'viable' }
}

/**
 * Write a plan receipt before any seat starts. Records the deterministic plan
 * hash (planSha256) and the inventory snapshot hash (inventorySha256) so the
 * plan cannot be silently replaced by a later mutable catalog claim. Independence
 * is 'full' when a separate synthesizer is available (or mode is none/probe) and
 * 'reduced' when the same model/provider must synthesize.
 */
export function createCouncilPlanReceipt(
  plan: CouncilPlan,
  resources: SurplusResource[] | undefined,
  logFile = defaultCouncilLedgerPath(),
  now?: Date,
): CouncilLedgerReceipt {
  const independence: CouncilIndependence =
    plan.synthesizer || plan.mode === 'none' ? 'full' : 'reduced'
  const inventory = inventorySummary(resources)
  const receipt = newCouncilLedgerReceipt({
    harness: plan.seats[0]?.harness ?? 'unknown',
    stage: 'plan',
    mode: plan.mode,
    intent: plan.intent,
    status: 'planned',
    evidence: 'none',
    source: 'live',
    independence,
    planSha256: councilHash(JSON.stringify(planSummary(plan))),
    ...(inventory.length > 0 ? { inventorySha256: councilHash(JSON.stringify(inventory)) } : {}),
    claimCount: plan.seats.length,
    now,
  })
  appendCouncilLedgerReceipt(receipt, logFile)
  return receipt
}
