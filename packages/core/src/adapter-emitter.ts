import { buildExecutionReceipt, isExecutionReceiptSource } from './receipts.ts'
import type { ExecutionReceipt, ExecutionReceiptSource } from './types.ts'

export const ADAPTER_IDS = [
  'command-code',
  'opencode',
  'hermes',
  'oh-my-pi',
  'prime-agent',
  'orca',
  'deepseek-harness',
  'kilo',
  'cline',
] as const

export type AdapterId = (typeof ADAPTER_IDS)[number]

export interface AdapterReceiptContext {
  adapter: AdapterId | string
  operationId: string
  source: ExecutionReceiptSource
  status?: 'passed' | 'failed' | 'unknown'
  exitCode?: number
  verifier?: string
  startedAt?: number
  durationMs?: number
  inputText?: string
  outputText?: string
  changedFiles?: unknown
  expectedScope?: number
  observedScope?: number
  isolation?: { workspaceId: string; disposable: boolean }
}

export interface AdapterReceiptEmitter {
  readonly adapter: AdapterId | string
  emit(ctx: AdapterReceiptContext): ExecutionReceipt
}

/** Explicit-unknown coverage: fields the adapter cannot report are never zero-filled. */
export function unknownFields(ctx: AdapterReceiptContext): string[] {
  const missing: string[] = []
  if (ctx.exitCode === undefined) missing.push('exitCode')
  if (ctx.verifier === undefined) missing.push('verifier')
  if (ctx.expectedScope === undefined) missing.push('expectedScope')
  if (ctx.observedScope === undefined) missing.push('observedScope')
  if (ctx.isolation === undefined) missing.push('isolation')
  return missing
}

/** Shared emitter: every adapter path funnels through this so the core shape is one. */
export function createAdapterEmitter(adapter: AdapterId | string): AdapterReceiptEmitter {
  return {
    adapter,
    emit(ctx: AdapterReceiptContext): ExecutionReceipt {
      if (ctx.adapter !== adapter) throw new Error(`emitter ${adapter} received ctx for ${ctx.adapter}`)
      if (!isExecutionReceiptSource(ctx.source)) throw new Error(`adapter ${adapter} emitted an unallowlisted source`)
      const receipt = buildExecutionReceipt({
        operationId: ctx.operationId,
        source: ctx.source,
        status: ctx.status,
        exitCode: ctx.exitCode,
        verifier: ctx.verifier,
        startedAt: ctx.startedAt,
        durationMs: ctx.durationMs,
        inputText: ctx.inputText,
        outputText: ctx.outputText,
        changedFiles: ctx.changedFiles,
        expectedScope: ctx.expectedScope,
        observedScope: ctx.observedScope,
        isolation: ctx.isolation,
      })
      return { ...receipt, operationId: `${adapter}:${receipt.operationId}` }
    },
  }
}