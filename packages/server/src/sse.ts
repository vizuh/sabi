import type { UsageTotals } from '@sabi/core'
import { isObject, UpstreamProtocolError, usageFromJson } from './upstream.ts'

export interface SseTapResult {
  model?: string
  usage?: UsageTotals
  finishReason?: string
  dataEvents: number
  /** A failure the provider reported inside an HTTP 200 stream (e.g. OpenRouter credit/context 402s). */
  upstreamError?: string
}

export interface SseTap {
  readonly done: boolean
  push(chunk: Uint8Array): Uint8Array
  flush(): Uint8Array
}

const EVENT_LIMIT = 4 * 1024 * 1024
const TERMINAL_REASONS = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])

function providerErrorMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (isObject(value) && typeof value.message === 'string' && value.message.trim()) return value.message.trim()
  return 'provider reported an error without a message'
}

/**
 * A failure the provider reported about itself, distinct from a protocol violation we detected:
 * only this class carries text worth persisting (credits, context length, rate limit).
 */
export class UpstreamStreamError extends UpstreamProtocolError {
  readonly providerMessage: string
  constructor(providerMessage: string) {
    super(`upstream stream error: ${providerMessage}`)
    this.name = 'UpstreamStreamError'
    this.providerMessage = providerMessage
  }
}

/**
 * Whether a choice that already emitted its terminal reason may appear again. Some providers
 * restate the finished choice on the final usage-bearing chunk (observed: same `stop` reason,
 * empty content, role echo). That idempotent echo is harmless; anything carrying new content —
 * tool-call deltas, real text, a different reason — is the post-terminal corruption the guard
 * exists for and must still reject.
 */
function isContentFreeRestatement(delta: unknown, finishReason: unknown, recorded: string | undefined): boolean {
  if (recorded === undefined) return false
  if (finishReason !== undefined && finishReason !== null && finishReason !== recorded) return false
  if (!isObject(delta)) return false
  if (typeof delta.content === 'string' && delta.content.length > 0) return false
  if (delta.tool_calls !== undefined || delta.function_call !== undefined) return false
  return true
}

/** Inspect complete events only. Tool deltas remain opaque, including argument fragments. */
export function createSseTap(alias: string, onFinish: (result: SseTapResult) => void): SseTap {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  const result: SseTapResult = { dataEvents: 0 }
  const choicesSeen = new Set<number>()
  const choicesFinished = new Set<number>()
  /** Terminal reason already emitted per choice, to recognise an idempotent restatement. */
  const terminalReason = new Map<number, string>()
  let buffer = ''
  let done = false
  let flushed = false

  function processEvent(event: string): string {
    const lines = event.split(/\r\n|\n|\r/)
    const data = lines.filter((line) => line.startsWith('data:'))
    if (!data.length) return event
    if (done) throw new UpstreamProtocolError('upstream sent data after [DONE]')
    const payload = data.map((line) => line.slice(5).replace(/^ /, '')).join('\n')
    if (payload === '[DONE]') {
      // Do not forward a success marker for usage-only replies or unfinished tool deltas.
      if (!choicesSeen.size || [...choicesSeen].some((index) => !choicesFinished.has(index))) {
        throw new UpstreamProtocolError('upstream stream ended without a terminal choice')
      }
      done = true
      return event
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      throw new UpstreamProtocolError('invalid upstream stream data')
    }
    if (isObject(parsed) && parsed.error !== undefined) {
      // The provider itself is reporting the failure — credits, context length, rate limit — inside a
      // stream it opened with HTTP 200. Carry its explanation out (sanitized by the caller) instead of
      // degrading it into an opaque protocol violation, which is what made this class undiagnosable.
      result.upstreamError = providerErrorMessage(parsed.error)
      throw new UpstreamStreamError(result.upstreamError)
    }
    if (!isObject(parsed) || !Array.isArray(parsed.choices)) {
      throw new UpstreamProtocolError('invalid upstream stream data')
    }
    for (const [position, choice] of parsed.choices.entries()) {
      if (!isObject(choice) || !isObject(choice.delta)) throw new UpstreamProtocolError('invalid upstream stream choice')
      const index = choice.index ?? position
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
        throw new UpstreamProtocolError('invalid upstream stream choice index')
      }
      if (choicesFinished.has(index)) {
        // A provider may restate the terminal choice on its final usage-bearing chunk (observed:
        // OpenAI-via-OpenRouter repeats `finish_reason: "stop"` with an empty delta). That
        // idempotent echo is allowed; anything carrying new content after the terminal reason —
        // the case the post-terminal guard exists for — still rejects.
        if (!isContentFreeRestatement(choice.delta, choice.finish_reason, terminalReason.get(index))) {
          throw new UpstreamProtocolError('upstream stream choice continued after terminal finish')
        }
        continue
      }
      choicesSeen.add(index)
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== 'string' || !TERMINAL_REASONS.has(choice.finish_reason)) {
          throw new UpstreamProtocolError('invalid upstream stream finish reason')
        }
        choicesFinished.add(index)
        terminalReason.set(index, choice.finish_reason)
        result.finishReason ??= choice.finish_reason
      }
    }
    if (!parsed.choices.length && (!choicesSeen.size || [...choicesSeen].some((index) => !choicesFinished.has(index)))) {
      throw new UpstreamProtocolError('upstream usage event arrived before a terminal choice')
    }
    result.dataEvents += 1
    const usage = usageFromJson(parsed)
    if (usage) result.usage = usage
    if (typeof parsed.model === 'string') result.model = parsed.model
    if (typeof parsed.model !== 'string' || parsed.model === alias) return event
    parsed.model = alias
    // Preserve event/id/retry/comment fields. Re-encode data without changing nested values.
    let replaced = false
    return lines.flatMap((line) => {
      if (!line.startsWith('data:')) return [line]
      if (replaced) return []
      replaced = true
      return [`data: ${JSON.stringify(parsed)}`]
    }).join(event.includes('\r\n') ? '\r\n' : '\n')
  }

  return {
    get done() { return done },
    push(chunk: Uint8Array): Uint8Array {
      if (flushed) throw new UpstreamProtocolError('stream already finished')
      buffer += decoder.decode(chunk, { stream: true })
      const output: string[] = []
      for (;;) {
        const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer)
        if (!boundary) break
        if (boundary.index > EVENT_LIMIT) throw new UpstreamProtocolError('upstream stream event too large')
        output.push(processEvent(buffer.slice(0, boundary.index)), boundary[0])
        buffer = buffer.slice(boundary.index + boundary[0].length)
      }
      if (buffer.length > EVENT_LIMIT) throw new UpstreamProtocolError('upstream stream event too large')
      return encoder.encode(output.join(''))
    },
    flush(): Uint8Array {
      if (flushed) return new Uint8Array(0)
      buffer += decoder.decode()
      const tail = buffer ? processEvent(buffer) : ''
      buffer = ''
      if (!done) {
        // `[DONE]` is a convention of the OpenAI-compatible shape, not a requirement every
        // compatible provider honours. A clean EOF after a terminal choice on every seen
        // choice (finish_reason observed, usage may already be recorded) is a complete round
        // whose usage/cost must survive — not a failure. Anything else (no terminal choice,
        // usage-only, mid-content cutoff) still fails rather than reporting success.
        const complete = result.dataEvents > 0 && choicesSeen.size > 0 &&
          [...choicesSeen].every((index) => choicesFinished.has(index))
        if (!complete) throw new UpstreamProtocolError('upstream stream ended without [DONE]')
        done = true
      }
      if (!result.dataEvents) throw new UpstreamProtocolError('upstream stream ended without [DONE]')
      flushed = true
      onFinish(result)
      return encoder.encode(tail)
    },
  }
}
