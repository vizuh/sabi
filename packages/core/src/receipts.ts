import { createHash } from 'node:crypto'
import type { ExecutionReceipt, ExecutionReceiptSource, ExecutionReceiptStatus } from './types.ts'

export const RECEIPT_SOURCES: readonly ExecutionReceiptSource[] = [
  'test',
  'build',
  'lint',
  'edit',
  'git',
  'repo-map',
  'sandbox',
]

export const RECEIPT_STATUSES: readonly ExecutionReceiptStatus[] = ['passed', 'failed', 'unknown']

export const MAX_OPERATION_ID_CHARS = 128
export const MAX_CHANGED_FILES = 64
export const MAX_FILENAME_CHARS = 128
export const MAX_VERIFIER_CHARS = 128

export function isExecutionReceiptSource(value: unknown): value is ExecutionReceiptSource {
  return typeof value === 'string' && (RECEIPT_SOURCES as readonly string[]).includes(value)
}

export function isExecutionReceiptStatus(value: unknown): value is ExecutionReceiptStatus {
  return typeof value === 'string' && (RECEIPT_STATUSES as readonly string[]).includes(value)
}

/** Stable bounded fingerprint of a value; the raw value is never retained. */
export function fingerprintValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Keep file names only: strip directories, drop empties, dedupe in order,
 * bound count and length. Absolute paths and contents never survive.
 */
export function sanitizeChangedFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue
    const base = entry.split(/[\\/]/).pop() ?? ''
    if (base.length === 0 || base.length > MAX_FILENAME_CHARS) continue
    if (seen.size >= MAX_CHANGED_FILES) break
    seen.add(base)
  }
  return seen.size > 0 ? [...seen] : undefined
}

export interface ReceiptInput {
  operationId: unknown
  source: unknown
  /** Explicit verdict wins when valid; otherwise derived from exitCode. */
  status?: unknown
  exitCode?: unknown
  verifier?: unknown
  startedAt?: unknown
  durationMs?: unknown
  /** Raw texts are fingerprinted, never stored. */
  inputText?: unknown
  outputText?: unknown
  changedFiles?: unknown
  expectedScope?: unknown
  observedScope?: unknown
  isolation?: unknown
}

function sanitizeIsolation(value: unknown): ExecutionReceipt['isolation'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const workspaceId = boundedText(record.workspaceId, MAX_OPERATION_ID_CHARS)
  if (workspaceId === undefined || typeof record.disposable !== 'boolean') return undefined
  return { workspaceId, disposable: record.disposable }
}

/**
 * Build a normalized execution receipt. Identity (`operationId`) and `source`
 * are required and fail closed; every other missing signal becomes an explicit
 * `unknown` or omission — never an invented default.
 */
export function buildExecutionReceipt(input: ReceiptInput): ExecutionReceipt {
  const operationId = boundedText(input.operationId, MAX_OPERATION_ID_CHARS)
  if (operationId === undefined) throw new Error('receipt requires a bounded operationId')
  if (!isExecutionReceiptSource(input.source)) throw new Error('receipt requires an allowlisted source')
  const exitCode = Number.isSafeInteger(input.exitCode) ? (input.exitCode as number) : undefined
  const status: ExecutionReceiptStatus = isExecutionReceiptStatus(input.status)
    ? input.status
    : exitCode === undefined
      ? 'unknown'
      : exitCode === 0
        ? 'passed'
        : 'failed'
  const expectedScope = finiteNonNegative(input.expectedScope)
  const observedScope = finiteNonNegative(input.observedScope)
  const receipt: ExecutionReceipt = {
    operationId,
    source: input.source,
    status,
    startedAt: finiteNonNegative(input.startedAt) ?? Date.now(),
    durationMs: finiteNonNegative(input.durationMs) ?? 0,
  }
  if (typeof input.inputText === 'string' && input.inputText.length > 0) {
    receipt.inputFingerprint = fingerprintValue(input.inputText)
  }
  if (typeof input.outputText === 'string' && input.outputText.length > 0) {
    receipt.outputFingerprint = fingerprintValue(input.outputText)
  }
  const changedFiles = sanitizeChangedFiles(input.changedFiles)
  if (changedFiles !== undefined) receipt.changedFiles = changedFiles
  const verifier = boundedText(input.verifier, MAX_VERIFIER_CHARS)
  if (verifier !== undefined) receipt.verifier = verifier
  if (exitCode !== undefined) receipt.exitCode = exitCode
  if (expectedScope !== undefined) receipt.expectedScope = expectedScope
  if (observedScope !== undefined) receipt.observedScope = observedScope
  if (expectedScope !== undefined && observedScope !== undefined) {
    receipt.scopeMismatch = observedScope !== expectedScope
  }
  const isolation = sanitizeIsolation(input.isolation)
  if (isolation !== undefined) receipt.isolation = isolation
  return receipt
}
