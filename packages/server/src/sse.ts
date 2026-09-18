import type { UsageTotals } from '@sabi/core'

export interface SseTapResult {
  model?: string
  usage?: UsageTotals
  finishReason?: string
  dataEvents: number
}

interface StreamObject {
  model?: unknown
  usage?: unknown
  choices?: Array<{ finish_reason?: unknown }>
}

function capture(object: StreamObject, result: SseTapResult): void {
  const usage = object.usage as Record<string, unknown> | undefined
  if (usage && typeof usage === 'object') {
    const promptTokens = Number(usage.prompt_tokens ?? 0) || 0
    const completionTokens = Number(usage.completion_tokens ?? 0) || 0
    const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
    const cachedTokens = Number(details?.cached_tokens ?? 0) || 0
    const totalTokens = Number(usage.total_tokens ?? 0) || promptTokens + completionTokens
    result.usage = { promptTokens, completionTokens, cachedTokens, totalTokens }
  }
  const finish = object.choices?.[0]?.finish_reason
  if (typeof finish === 'string' && finish) result.finishReason = finish
  if (typeof object.model === 'string') result.model = object.model
}

export interface SseTap {
  push(chunk: Uint8Array): Uint8Array
  flush(): Uint8Array
}

export function createSseTap(alias: string, onFinish: (result: SseTapResult) => void): SseTap {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const result: SseTapResult = { dataEvents: 0 }
  let buffer = ''

  function processLine(line: string): string {
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!bare.startsWith('data:')) return line
    const payload = bare.slice(5).trimStart()
    if (!payload || payload === '[DONE]') return line
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return line
    }
    if (!parsed || typeof parsed !== 'object') return line
    result.dataEvents += 1
    const object = parsed as StreamObject
    capture(object, result)
    if (typeof object.model === 'string' && object.model !== alias) {
      object.model = alias
      return `data: ${JSON.stringify(object)}`
    }
    return line
  }

  return {
    push(chunk: Uint8Array): Uint8Array {
      const text = buffer + decoder.decode(chunk, { stream: true })
      const parts = text.split('\n')
      buffer = parts.pop() ?? ''
      if (!parts.length) return new Uint8Array(0)
      return encoder.encode(`${parts.map(processLine).join('\n')}\n`)
    },
    flush(): Uint8Array {
      let tail = ''
      if (buffer.length) {
        tail = processLine(buffer)
        buffer = ''
      }
      onFinish(result)
      return encoder.encode(tail)
    },
  }
}
