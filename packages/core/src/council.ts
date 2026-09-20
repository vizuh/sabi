import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export type CouncilMode = 'none' | 'probe' | 'panel' | 'debate' | 'council'
export type CouncilStage = 'plan' | 'review' | 'cross-examination' | 'synthesis' | 'verification'
export type CouncilReceiptStatus = 'planned' | 'started' | 'completed' | 'failed' | 'unavailable' | 'unverified'
export type CouncilEvidenceLevel = 'none' | 'transport' | 'execution' | 'completion' | 'verification'
export type CouncilReceiptSource = 'live' | 'mock' | 'simulated'
export type CouncilIntent = 'bug-hunt' | 'test-gap' | 'api-contract' | 'architecture' | 'security' | 'quality' | 'other'

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
  reason: 'none-needed' | 'single-uncertainty' | 'independent-risks' | 'conflicting-claims' | 'high-consequence'
  seats: CouncilSeat[]
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

const MODES = new Set<CouncilMode>(['none', 'probe', 'panel', 'debate', 'council'])
const STAGES = new Set<CouncilStage>(['plan', 'review', 'cross-examination', 'synthesis', 'verification'])
const STATUSES = new Set<CouncilReceiptStatus>(['planned', 'started', 'completed', 'failed', 'unavailable', 'unverified'])
const EVIDENCE = new Set<CouncilEvidenceLevel>(['none', 'transport', 'execution', 'completion', 'verification'])
const SOURCES = new Set<CouncilReceiptSource>(['live', 'mock', 'simulated'])
const INTENTS = new Set<CouncilIntent>(['bug-hunt', 'test-gap', 'api-contract', 'architecture', 'security', 'quality', 'other'])
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

export function appendCouncilLedgerReceipt(receipt: CouncilLedgerReceipt, logFile = defaultCouncilLedgerPath()): void {
  mkdirSync(path.dirname(logFile), { recursive: true })
  appendFileSync(logFile, `${JSON.stringify(receipt)}\n`)
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
