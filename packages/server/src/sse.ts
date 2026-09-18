import type { UsageTotals } from '@sabi/core'
import { isObject, UpstreamProtocolError, usageFromJson } from './upstream.ts'

export interface SseTapResult {
  model?: string
  usage?: UsageTotals
  finishReason?: string
  dataEvents: number
}

export interface SseTap {
  readonly done: boolean
  push(chunk: Uint8Array): Uint8Array
  flush(): Uint8Array
}

const EVENT_LIMIT = 4 * 1024 * 1024
const TERMINAL_REASONS = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])

/** Inspect complete events only. Tool deltas remain opaque, including argument fragments. */
export function createSseTap(alias: string, onFinish: (result: SseTapResult) => void): SseTap {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  const result: SseTapResult = { dataEvents: 0 }
  const choicesSeen = new Set<number>()
  const choicesFinished = new Set<number>()
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
    if (!isObject(parsed) || !Array.isArray(parsed.choices) || parsed.error !== undefined) {
      throw new UpstreamProtocolError('invalid upstream stream data')
    }
    for (const [position, choice] of parsed.choices.entries()) {
      if (!isObject(choice) || !isObject(choice.delta)) throw new UpstreamProtocolError('invalid upstream stream choice')
      const index = choice.index ?? position
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
        throw new UpstreamProtocolError('invalid upstream stream choice index')
      }
      if (choicesFinished.has(index)) {
        throw new UpstreamProtocolError('upstream stream choice continued after terminal finish')
      }
      choicesSeen.add(index)
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== 'string' || !TERMINAL_REASONS.has(choice.finish_reason)) {
          throw new UpstreamProtocolError('invalid upstream stream finish reason')
        }
        choicesFinished.add(index)
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
      if (!done || !result.dataEvents) throw new UpstreamProtocolError('upstream stream ended without [DONE]')
      flushed = true
      onFinish(result)
      return encoder.encode(tail)
    },
  }
}
