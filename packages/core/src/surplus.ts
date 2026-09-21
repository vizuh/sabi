import { existsSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { appendPrivateLine } from './log.ts'
import type { SabiConfig } from './types.ts'
import { looksLikeCanary } from './telemetry.ts'

export type SurplusReviewIntent = 'bug-hunt' | 'test-gap' | 'api-contract'
export type SurplusResourceTrust = 'local' | 'external-free'
export type SurplusReviewStatus = 'ok' | 'blocked' | 'skipped' | 'unavailable' | 'unverifiable' | 'error'

export interface SurplusResource {
  alias: string
  tier: string
  provider: string
  model: string
  trust: SurplusResourceTrust
  cost: { input: 0; output: 0 }
  capabilities: { text: true; tools: boolean }
}

export interface SafeReviewPacket {
  version: 1
  intent: SurplusReviewIntent
  changedFiles: string[]
  diff: string
  diffSha256: string
  truncated: boolean
}

export type ReviewPacketResult =
  | { ok: true; packet: SafeReviewPacket }
  | { ok: false; reason: 'secret-path' | 'secret-marker' | 'unsafe-path' }

export interface ReviewClaim {
  category: 'bug' | 'test-gap' | 'api-contract' | 'other'
  severity: 'low' | 'medium' | 'high'
  claim: string
  file?: string
  line?: number
  evidence?: string
  confidence?: number
}

export interface ReviewClaimParseResult {
  status: 'ok' | 'unverifiable'
  claims: ReviewClaim[]
}

export interface SurplusReviewReceipt {
  version: 1
  reviewId: string
  ts: string
  taskKey: string
  intent: SurplusReviewIntent
  resource: Pick<SurplusResource, 'alias' | 'provider' | 'model' | 'trust'>
  packetSha256?: string
  status: SurplusReviewStatus
  parseStatus: 'not-run' | 'ok' | 'unverifiable'
  claimCount: number
  verifiedClaimCount: 0
  verification: 'not-run'
  latencyMs?: number
  transportStatus?: number
  errorCode?: string
}

const MAX_DIFF_CHARS = 24_000
const MAX_FILES = 64
const MAX_CLAIMS = 20
const MAX_CLAIM_CHARS = 800
const MAX_EVIDENCE_CHARS = 400
const SENSITIVE_COMPONENT = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.dockerconfigjson|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|(?:secrets?|credentials?|passwords?|tokens?)(?:$|[._-](?:json|ya?ml|txt|env|ini|conf|cfg|properties|local|prod(?:uction)?|dev(?:elopment)?|test|staging)(?:[._-].*)?))$/i
const SENSITIVE_EXTENSION = /\.(?:pem|key|p12|pfx|crt|cer|der)$/i
const CATEGORY = new Set<ReviewClaim['category']>(['bug', 'test-gap', 'api-contract', 'other'])
const SEVERITY = new Set<ReviewClaim['severity']>(['low', 'medium', 'high'])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function isSensitiveFile(value: string): boolean {
  const file = value.trim().replaceAll('\\', '/')
  return file.split('/').some((component) => SENSITIVE_COMPONENT.test(component) || SENSITIVE_EXTENSION.test(component))
}

function safeFile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const file = value.trim().replaceAll('\\', '/')
  if (!file || file.startsWith('/') || /^[A-Za-z]:\//.test(file) || file.split('/').includes('..')) return undefined
  if (isSensitiveFile(file)) return undefined
  return file.slice(0, 240)
}

export function hasSensitivePath(files: string[]): boolean {
  return files.some((file) => file.split(' => ').some((part) => isSensitiveFile(part)))
}

function parseJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const source = fenced ?? value.trim()
  try {
    return JSON.parse(source) as unknown
  } catch {
    const start = Math.min(...['{', '['].map((token) => {
      const index = source.indexOf(token)
      return index < 0 ? Number.POSITIVE_INFINITY : index
    }))
    const end = Math.max(source.lastIndexOf('}'), source.lastIndexOf(']'))
    if (!Number.isFinite(start) || end <= start) return undefined
    try { return JSON.parse(source.slice(start, end + 1)) as unknown } catch { return undefined }
  }
}

export function surplusResources(config: SabiConfig): SurplusResource[] {
  const resources: SurplusResource[] = []
  for (const [alias, target] of Object.entries(config.aliases)) {
    if (target === 'auto') continue
    const model = config.models[target]
    const upstream = model ? config.upstreams[model.upstream] : undefined
    if (!model || !upstream || upstream.enabled === false || model.cost?.input !== 0 || model.cost?.output !== 0) continue
    if (!model.capabilities?.inputModalities?.includes('text')) continue
    resources.push({
      alias,
      tier: target,
      provider: model.upstream,
      model: model.model,
      trust: upstream.apiKey === false ? 'local' : 'external-free',
      cost: { input: 0, output: 0 },
      capabilities: { text: true, tools: model.capabilities.tools === true },
    })
  }
  return resources.sort((left, right) => (left.trust === 'local' ? 0 : 1) - (right.trust === 'local' ? 0 : 1) || left.alias.localeCompare(right.alias))
}

export function buildSafeReviewPacket(input: {
  intent: SurplusReviewIntent
  changedFiles: string[]
  diff: string
  maxChars?: number
}): ReviewPacketResult {
  const files = input.changedFiles.map((file) => file.trim()).filter(Boolean)
  if (files.length > MAX_FILES) return { ok: false, reason: 'unsafe-path' }
  if (hasSensitivePath(files)) return { ok: false, reason: 'secret-path' }
  if (files.some((file) => !safeFile(file.split(' => ')[0]) || (file.includes(' => ') && !safeFile(file.split(' => ')[1]))) || files.length > MAX_FILES) {
    return { ok: false, reason: 'unsafe-path' }
  }
  if (looksLikeCanary(input.diff)) return { ok: false, reason: 'secret-marker' }
  const maxChars = Math.max(1, Math.min(input.maxChars ?? MAX_DIFF_CHARS, MAX_DIFF_CHARS))
  const diff = input.diff.slice(0, maxChars)
  return {
    ok: true,
    packet: {
      version: 1,
      intent: input.intent,
      changedFiles: files,
      diff,
      diffSha256: hash(input.diff),
      truncated: diff.length < input.diff.length,
    },
  }
}

export function parseReviewClaims(content: string): ReviewClaimParseResult {
  const parsed = parseJson(content)
  const object = record(parsed)
  const rawClaims = Array.isArray(parsed) ? parsed : object?.claims
  if (!Array.isArray(rawClaims)) return { status: 'unverifiable', claims: [] }
  const claims: ReviewClaim[] = []
  for (const raw of rawClaims.slice(0, MAX_CLAIMS)) {
    const item = record(raw)
    const claim = typeof item?.claim === 'string' ? item.claim.trim().slice(0, MAX_CLAIM_CHARS) : ''
    if (!claim || looksLikeCanary(claim)) continue
    const file = safeFile(item?.file)
    const evidence = typeof item?.evidence === 'string' ? item.evidence.trim().slice(0, MAX_EVIDENCE_CHARS) : undefined
    if (evidence && looksLikeCanary(evidence)) continue
    const category = CATEGORY.has(item?.category as ReviewClaim['category']) ? item?.category as ReviewClaim['category'] : 'other'
    const severity = SEVERITY.has(item?.severity as ReviewClaim['severity']) ? item?.severity as ReviewClaim['severity'] : 'medium'
    const confidence = typeof item?.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1
      ? item.confidence
      : undefined
    const line = typeof item?.line === 'number' && Number.isSafeInteger(item.line) && item.line > 0 ? item.line : undefined
    claims.push({ category, severity, claim, ...(file ? { file } : {}), ...(line ? { line } : {}), ...(evidence ? { evidence } : {}), ...(confidence === undefined ? {} : { confidence }) })
  }
  return { status: 'ok', claims }
}

export function surplusTaskKey(resourceAlias: string, intent: SurplusReviewIntent): string {
  return hash(`${resourceAlias}\0${intent}`)
}

export function newSurplusReviewReceipt(input: {
  intent: SurplusReviewIntent
  resource: SurplusResource
  status: SurplusReviewStatus
  parseStatus: SurplusReviewReceipt['parseStatus']
  claimCount: number
  packetSha256?: string
  latencyMs?: number
  transportStatus?: number
  errorCode?: string
  now?: Date
}): SurplusReviewReceipt {
  return {
    version: 1,
    reviewId: randomUUID(),
    ts: (input.now ?? new Date()).toISOString(),
    taskKey: surplusTaskKey(input.resource.alias, input.intent),
    intent: input.intent,
    resource: { alias: input.resource.alias, provider: input.resource.provider, model: input.resource.model, trust: input.resource.trust },
    ...(input.packetSha256 ? { packetSha256: input.packetSha256 } : {}),
    status: input.status,
    parseStatus: input.parseStatus,
    claimCount: Math.max(0, Math.floor(input.claimCount)),
    verifiedClaimCount: 0,
    verification: 'not-run',
    ...(input.latencyMs === undefined ? {} : { latencyMs: Math.max(0, Math.round(input.latencyMs)) }),
    ...(input.transportStatus === undefined ? {} : { transportStatus: input.transportStatus }),
    ...(input.errorCode ? { errorCode: input.errorCode.slice(0, 80) } : {}),
  }
}

export function defaultSurplusLogPath(): string {
  return process.env.SABI_SURPLUS_LOG?.trim() || path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'), 'sabi', 'surplus-reviews.jsonl')
}

export function appendSurplusReviewReceipt(receipt: SurplusReviewReceipt, logFile = defaultSurplusLogPath()): void {
  appendPrivateLine(logFile, `${JSON.stringify(receipt)}\n`)
}

export function readSurplusReviewReceipts(logFile = defaultSurplusLogPath()): SurplusReviewReceipt[] {
  if (!existsSync(logFile)) return []
  const rows: SurplusReviewReceipt[] = []
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (record(value)?.version === 1 && typeof record(value)?.reviewId === 'string') rows.push(value as SurplusReviewReceipt)
    } catch {
      // Ignore a torn or malformed receipt; the next review remains append-only.
    }
  }
  return rows
}
