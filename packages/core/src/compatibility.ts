import { Buffer } from 'node:buffer'
import { buildEffectiveRequestEnvelope } from './request.ts'
import type { ChatRequestBody, ModelEntry, ModelModality, RouteDecision, SabiConfig, UpstreamEntry } from './types.ts'

export class SabiRouteError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SabiRouteError'
    this.status = status
  }
}

const MODALITIES = new Set(['text', 'image', 'audio', 'video', 'file'])
const BASE_PARAMETERS = new Set(['model', 'messages', 'stream'])
const MESSAGE_FIELDS = new Set(['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call', 'refusal'])
const REASONING_HISTORY = new Set(['reasoning', 'reasoning_content', 'reasoning_details', 'thinking_blocks'])

/**
 * Whether a model whose declared input modalities are `declared` can serve `required`. An
 * undeclared capability is unknown, not a refusal — the same rule the route check applies, so
 * declaring one modality never silently blocks a model the operator has not described.
 */
export function servesInputModalities(
  declared: ModelModality[] | undefined,
  required: readonly ModelModality[],
): boolean {
  if (!declared) return true
  return required.every((modality) => declared.includes(modality))
}

/**
 * First tier, in sorted tier-name order, whose declared modalities cover `required`. Name order
 * is the documented preference order, so the fallback never depends on JSON declaration order:
 * the same tier set always resolves the same way no matter how the config file lists it.
 */
export function firstServingTier<T>(
  tiers: Record<string, T>,
  required: readonly ModelModality[],
  declared: (tier: T) => ModelModality[] | undefined,
): string | undefined {
  for (const name of Object.keys(tiers).sort()) {
    if (servesInputModalities(declared(tiers[name] as T), required)) return name
  }
  return undefined
}

/** Declared per-million-token route cost, or infinity when unknown — unknown never beats known. */
export function modelRouteCost(model: Pick<ModelEntry, 'cost'> | undefined): number {
  const input = model?.cost?.input
  const output = model?.cost?.output
  if (typeof input !== 'number' || typeof output !== 'number') return Number.POSITIVE_INFINITY
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    return Number.POSITIVE_INFINITY
  }
  return input + output
}

/**
 * Cheapest tier satisfying `serves`, ties broken by tier name — independent of JSON declaration
 * order. Cost is the declared `cost.input + cost.output`; tiers without a usable declared cost
 * sort after every priced tier, alphabetically among themselves.
 */
export function cheapestServingTier(
  models: Record<string, ModelEntry>,
  serves: (name: string, entry: ModelEntry) => boolean,
): string | undefined {
  return Object.keys(models)
    .filter((name) => {
      const entry = models[name]
      return entry !== undefined && serves(name, entry)
    })
    .sort((a, b) => {
      const costA = modelRouteCost(models[a])
      const costB = modelRouteCost(models[b])
      if (costA !== costB) return costA - costB
      return a < b ? -1 : a > b ? 1 : 0
    })[0]
}

/** Single definition of the kill-switch predicate: omitted or true means usable. */
export function isEnabledUpstream(upstream: UpstreamEntry | undefined): boolean {
  return upstream !== undefined && upstream.enabled !== false
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Validate the selected route and its effective forwarded envelope without changing the
 * input body, route or policy. Call this again after a judge override. Strict mode fails on unknown metadata; legacy mode permits
 * omissions but never overrides an explicit negative capability or silently drops a field.
 * Native Command Code planRound() has its own host catalog and does not call this function.
 */
export function ensureRouteCompatible(body: ChatRequestBody, config: SabiConfig, decision: RouteDecision): void {
  const fail: (message: string) => never = (message) => {
    throw new SabiRouteError(`incompatible route '${decision.tier}': ${message}`)
  }
  if (!object(body)) fail('request must be a JSON object')
  const rawAlias = typeof body.model === 'string' ? body.model.trim() : ''
  const alias = rawAlias.slice(rawAlias.lastIndexOf('/') + 1)
  const target = Object.hasOwn(config.aliases, alias) ? config.aliases[alias] : undefined
  if (!target || alias !== decision.alias) fail('request alias does not match the decision')
  if (target !== 'auto' && (decision.tier !== target || decision.mode !== 'fixed')) {
    fail('fixed alias cannot change backend')
  }
  if (target === 'auto' && decision.mode !== 'auto') fail('adaptive alias requires an adaptive decision')
  const model = Object.hasOwn(config.models, decision.tier) ? config.models[decision.tier] : undefined
  if (!model || decision.model !== decision.tier || decision.upstream !== model.upstream || decision.upstreamModel !== model.model) {
    fail('decision does not match the configured backend')
  }
  // The checks above narrow the backend at runtime as well as guarding judge mutations.
  if (!model) return
  if (!isEnabledUpstream(config.upstreams[model.upstream])) {
    fail(`upstream '${model.upstream}' is disabled`)
  }
  if (body.stream_options !== undefined && !object(body.stream_options)) fail('stream_options must be an object')
  if (body.stream_options?.include_usage !== undefined && typeof body.stream_options.include_usage !== 'boolean') {
    fail('stream_options.include_usage must be a boolean')
  }
  // Keep pin validation above on the original alias. Validate the exact forwarded
  // parameter set and account for backend-id/usage-option bytes below.
  const forwarded = buildEffectiveRequestEnvelope(config, decision, body)
  const strict = config.compatibility?.mode === 'strict'
  const caps = model.capabilities
  const parameters = caps?.supportedParameters
  const needsBoolean = (feature: string, supported: boolean | undefined): void => {
    if (supported !== true && (strict || supported !== undefined)) {
      fail(`${feature} ${supported === undefined ? 'capability is unknown' : 'is not supported'}`)
    }
  }
  const needsValue = (feature: string, value: string, supported: string[] | undefined): void => {
    if (!supported?.includes(value) && (strict || supported !== undefined)) {
      fail(`${feature} ${supported === undefined ? 'capability is unknown' : 'is not supported'}`)
    }
  }
  const extension = (parameter: string): void => {
    if ((strict || parameters !== undefined) && !parameters?.includes(parameter)) {
      fail(`parameter '${parameter}' is not declared supported`)
    }
  }
  for (const key of Object.keys(forwarded)) {
    if (forwarded[key] !== undefined && !BASE_PARAMETERS.has(key)) extension(key)
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') fail('stream must be a boolean')
  if (body.messages !== undefined && !Array.isArray(body.messages)) fail('messages must be an array')
  const messages: unknown[] = body.messages ?? []
  if (strict && !messages.length) fail('messages must be a nonempty array')

  const media: Partial<Record<Exclude<ModelModality, 'text'>, number>> = {}
  const input = (modality: ModelModality): void => {
    needsValue(`input modality '${modality}'`, modality, caps?.inputModalities)
    if (modality !== 'text') media[modality] = (media[modality] ?? 0) + 1
  }
  // Tool schemas, role names and text framing also require text input support.
  input('text')
  let usesTools = false
  for (const message of messages) {
    if (!object(message)) fail('each message must be an object')
    if (strict && !['system', 'developer', 'user', 'assistant', 'tool', 'function'].includes(String(message.role))) {
      fail('message role is not supported')
    }
    if (message.role === 'developer') extension('messages.developer')
    if (message.role === 'tool' || message.role === 'function' || message.tool_call_id !== undefined || message.function_call !== undefined) {
      usesTools = true
    }
    if (message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls)) fail('message tool_calls must be an array')
      usesTools ||= message.tool_calls.length > 0
      if (message.tool_calls.length > 1) needsBoolean('parallel tools', caps?.parallelTools)
      for (const call of message.tool_calls) {
        if (!object(call) || (strict && call.type !== undefined && call.type !== 'function')) fail('tool call type is not supported')
      }
    }
    for (const key of Object.keys(message)) {
      if (message[key] === undefined || MESSAGE_FIELDS.has(key)) continue
      extension(`messages.${key}`)
      if (REASONING_HISTORY.has(key) && strict && decision.mode !== 'fixed') {
        fail('provider-specific reasoning history requires a fixed alias and declared message parameter')
      }
      if (key === 'audio') {
        if (strict && decision.mode !== 'fixed') fail('provider-specific audio history requires a fixed alias')
        input('audio')
      }
    }
    const content = message.content
    if (content === undefined || content === null || typeof content === 'string') continue
    if (!Array.isArray(content)) {
      if (strict) fail('message content must be text or documented content parts')
      continue
    }
    for (const part of content) {
      if (!object(part)) {
        if (strict) fail('content parts must be objects')
        continue
      }
      const kind = part.type
      if (kind === 'text') {
        if (typeof part.text !== 'string') fail('text content part requires text')
      } else if (kind === 'image_url') {
        if (!object(part.image_url) || typeof part.image_url.url !== 'string' || !part.image_url.url) fail('image_url content part requires a URL')
        input('image')
      } else if (kind === 'input_audio') {
        if (!object(part.input_audio) || typeof part.input_audio.data !== 'string' || typeof part.input_audio.format !== 'string') fail('input_audio content part requires data and format')
        input('audio')
      } else if (kind === 'video_url') {
        if (!object(part.video_url) || typeof part.video_url.url !== 'string' || !part.video_url.url) fail('video_url content part requires a URL')
        input('video')
      } else if (kind === 'file') {
        if (!object(part.file) || (typeof part.file.file_id !== 'string' && typeof part.file.file_data !== 'string')) fail('file content part requires file_id or file_data')
        if (strict && part.file.file_id !== undefined && decision.mode !== 'fixed') fail('provider-specific file reference requires a fixed alias')
        input('file')
      } else if (strict || caps?.inputModalities !== undefined) {
        fail('content part type is unknown; cannot prove modality compatibility')
      }
      if (strict) {
        for (const key of Object.keys(part)) {
          if (key !== 'type' && key !== kind) extension(`messages.content.${key}`)
        }
      }
    }
  }

  for (const name of ['tools', 'functions'] as const) {
    const tools = body[name]
    if (tools === undefined) continue
    if (!Array.isArray(tools)) fail(`${name} must be an array`)
    usesTools ||= tools.length > 0
    for (const tool of tools) {
      if (!object(tool)) fail('tool definitions must be objects')
      if (name === 'tools' && strict && tool.type !== 'function') fail('only function tool definitions are supported')
      const definition = name === 'tools' ? tool.function : tool
      if (strict && (!object(definition) || typeof definition.name !== 'string' || !definition.name)) fail('function tool requires a name')
      if (object(definition) && definition.strict !== undefined) {
        if (typeof definition.strict !== 'boolean') fail('tool strict flag must be a boolean')
        if (definition.strict) needsBoolean('strict tools', caps?.strictTools)
      }
    }
  }
  usesTools ||= body.tool_choice !== undefined || body.function_call !== undefined
  if (body.tool_choice !== undefined && strict) {
    const choice = body.tool_choice
    if (typeof choice === 'string') {
      if (!['auto', 'none', 'required'].includes(choice)) fail('tool_choice is not supported')
    } else if (!object(choice) || choice.type !== 'function' || !object(choice.function) || typeof choice.function.name !== 'string') {
      fail('tool_choice requires a supported choice or a function name')
    }
  }
  if (usesTools) needsBoolean('tools', caps?.tools)
  if (body.parallel_tool_calls !== undefined) {
    if (typeof body.parallel_tool_calls !== 'boolean') fail('parallel_tool_calls must be a boolean')
    if (body.parallel_tool_calls) {
      needsBoolean('tools', caps?.tools)
      needsBoolean('parallel tools', caps?.parallelTools)
    }
  }
  if (body.response_format !== undefined) {
    const format = body.response_format
    if (!object(format) || !['text', 'json_object', 'json_schema'].includes(String(format.type))) fail('response_format type is not supported')
    if (format.type !== 'text') needsValue('structured output', String(format.type), caps?.structuredOutput)
    if (format.type === 'json_schema' && (!object(format.json_schema) || !object(format.json_schema.schema))) fail('json_schema output requires a schema')
  }
  const outputModalities = body.modalities === undefined ? ['text'] : body.modalities
  if (!Array.isArray(outputModalities) || !outputModalities.length) fail('modalities must be a nonempty array')
  for (const modality of outputModalities) {
    if (typeof modality !== 'string' || !MODALITIES.has(modality)) fail('output modality is unknown')
    needsValue(`output modality '${modality}'`, modality, caps?.outputModalities)
  }
  if (body.audio !== undefined) needsValue('audio output', 'audio', caps?.outputModalities)

  if (body.reasoning_effort !== undefined) {
    if (typeof body.reasoning_effort !== 'string' || !body.reasoning_effort) fail('reasoning_effort must be a nonempty string')
    needsValue('reasoning effort', body.reasoning_effort, caps?.reasoningEfforts)
  }
  let reasoningTokens: number | undefined
  if (body.reasoning !== undefined) {
    if (!object(body.reasoning)) fail('reasoning must be an object')
    const reasoning = body.reasoning as Record<string, unknown>
    if (body.reasoning_effort !== undefined) fail('use only one reasoning control form')
    for (const key of Object.keys(reasoning)) {
      if (!['effort', 'max_tokens', 'enabled', 'exclude'].includes(key)) fail('reasoning parameter is not supported')
    }
    if (reasoning.effort !== undefined) {
      if (typeof reasoning.effort !== 'string' || !reasoning.effort) fail('reasoning.effort must be a nonempty string')
      needsValue('reasoning effort', reasoning.effort, caps?.reasoningEfforts)
    }
    for (const key of ['enabled', 'exclude']) {
      if (reasoning[key] !== undefined && typeof reasoning[key] !== 'boolean') fail(`reasoning.${key} must be a boolean`)
    }
    if (reasoning.max_tokens !== undefined) {
      if (!positiveInteger(reasoning.max_tokens)) fail('reasoning.max_tokens must be a positive safe integer')
      reasoningTokens = reasoning.max_tokens as number
    }
    if ((reasoning.enabled === true || reasoningTokens !== undefined) && !caps?.reasoningEfforts?.length && (strict || caps?.reasoningEfforts !== undefined)) {
      fail('reasoning capability is unknown or unsupported')
    }
    if (reasoning.enabled === false && (reasoning.effort !== undefined || reasoningTokens !== undefined)) fail('disabled reasoning conflicts with an effort or token budget')
  }

  if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) fail('use only one output token limit')
  for (const key of ['max_tokens', 'max_completion_tokens']) {
    if (body[key] !== undefined && !positiveInteger(body[key])) fail('output token limit must be a positive safe integer')
  }
  const requestedOutput = body.max_completion_tokens ?? body.max_tokens
  if (model.maxOutputTokens !== undefined && !positiveInteger(model.maxOutputTokens)) fail('catalog maxOutputTokens must be a positive safe integer')
  if (model.contextWindow !== undefined && !positiveInteger(model.contextWindow)) fail('catalog contextWindow must be a positive safe integer')
  if (strict && model.maxOutputTokens === undefined) fail('maxOutputTokens is unknown')
  if (strict && model.contextWindow === undefined) fail('contextWindow is unknown')
  const outputReserve = requestedOutput === undefined ? model.maxOutputTokens : requestedOutput as number
  if (outputReserve !== undefined && model.maxOutputTokens !== undefined && outputReserve > model.maxOutputTokens) fail('output token limit exceeds maxOutputTokens')
  if (reasoningTokens !== undefined && outputReserve !== undefined && reasoningTokens > outputReserve) fail('reasoning token budget exceeds the output reserve')

  const accounting = model.contextAccounting
  if (!accounting) {
    if (strict) fail('contextAccounting is unknown; full request fit cannot be proved')
    return
  }
  if (model.contextWindow === undefined || outputReserve === undefined) {
    if (strict) fail('context or output reserve is unknown')
    return
  }
  let serialized: string
  try {
    // Includes system text, tool schemas, history, backend model id, injected usage
    // options and all extensions. These bytes match the shared dispatch builder.
    serialized = JSON.stringify(forwarded)
  } catch {
    fail('request is not JSON serializable')
  }
  let inputBound = Math.ceil(Buffer.byteLength(serialized!, 'utf8') * accounting.textTokensPerByte) +
    accounting.requestOverheadTokens + messages.length * accounting.perMessageOverheadTokens
  for (const [modality, count] of Object.entries(media)) {
    const tokens = accounting.mediaTokens?.[modality as Exclude<ModelModality, 'text'>]
    if (!positiveInteger(tokens)) {
      if (strict) fail(`context token bound for '${modality}' is unknown`)
      return
    }
    inputBound += count * tokens
  }
  if (!Number.isSafeInteger(inputBound) || inputBound < 0) fail('contextAccounting produced an invalid token bound')
  if (inputBound + outputReserve > model.contextWindow) fail('full request context plus output reserve exceeds contextWindow')
}
