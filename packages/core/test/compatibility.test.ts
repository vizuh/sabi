import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { buildEffectiveRequestEnvelope, ensureRouteCompatible, route, SabiRouteError } from '../src/index.ts'
import { validateConfig } from '../src/config.ts'
import type { ChatRequestBody, ModelCapabilities, ModelEntry, SabiConfig } from '../src/types.ts'

// All model metadata is synthetic. These are not claims about any live model.
function catalog(patch: Partial<ModelEntry> = {}): ModelEntry {
  return {
    upstream: 'mock', model: 'synthetic', contextWindow: 20_000, maxOutputTokens: 2_000,
    capabilities: {
      tools: true, parallelTools: true, strictTools: true,
      inputModalities: ['text', 'image', 'audio', 'video', 'file'], outputModalities: ['text', 'audio'],
      structuredOutput: ['json_object', 'json_schema'], reasoningEfforts: ['low', 'high'],
      supportedParameters: ['tools', 'functions', 'function_call', 'tool_choice', 'parallel_tool_calls',
        'response_format', 'reasoning_effort', 'reasoning', 'max_tokens', 'max_completion_tokens',
        'modalities', 'audio', 'stream_options', 'temperature', 'messages.reasoning_details'],
    },
    contextAccounting: {
      textTokensPerByte: 1, requestOverheadTokens: 8, perMessageOverheadTokens: 4,
      mediaTokens: { image: 100, audio: 200, video: 300, file: 400 },
    },
    ...patch,
  }
}

function config(patch: Partial<ModelEntry> = {}): SabiConfig {
  return validateConfig({
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
    models: { cheap: catalog(patch), other: catalog({ model: 'synthetic-other' }) },
    aliases: { 'sabi-code': 'auto', 'sabi-fixed': 'cheap' },
    policy: { 'first-turn': 'cheap', unclassified: 'cheap' },
    compatibility: { mode: 'strict' },
  })
}

function body(patch: Record<string, unknown> = {}): ChatRequestBody {
  return { model: 'sabi-code', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, ...patch }
}

function rejected(request: ChatRequestBody, settings: SabiConfig, expected: RegExp): void {
  assert.throws(() => route(request, settings), (error: unknown) => {
    assert.ok(error instanceof SabiRouteError)
    assert.equal(error.status, 400)
    assert.match(error.message, expected)
    return true
  })
}

test('strict route preserves the body and selected decision; checker is exported and synchronous', () => {
  const settings = config()
  const request = body({ stream: true, stream_options: { include_usage: true } })
  const before = structuredClone(request)
  const decision = route(request, settings)
  assert.equal(decision.tier, 'cheap')
  assert.equal(ensureRouteCompatible(request, settings, decision), undefined)
  assert.deepEqual(request, before)
  assert.equal(decision.state.contextKnown, false, 'an operator bound is not measured context usage')
})

test('tools in definitions and historical calls/results require explicit support', () => {
  const noTools = config({ capabilities: { ...catalog().capabilities, tools: false, parallelTools: false, strictTools: false } })
  const requests = [
    body({ tools: [{ type: 'function', function: { name: 'mcp__odd__tool', parameters: { type: 'object' } } }] }),
    body({ messages: [{ role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'x', arguments: '{}' } }] }] }),
    body({ messages: [{ role: 'tool', tool_call_id: 'call-1', content: 'done' }] }),
    body({ functions: [{ name: 'legacy' }] }),
    body({ tool_choice: 'required' }),
  ]
  for (const request of requests) {
    assert.doesNotThrow(() => route(request, config()))
    rejected(request, noTools, /tools is not supported/)
  }
})

test('unknown tool support fails in strict mode, and parallel or strict tools need separate metadata', () => {
  rejected(body({ tools: [{ type: 'function', function: { name: 'x' } }] }), config({ capabilities: { ...catalog().capabilities, tools: undefined } }), /tools capability is unknown/)
  rejected(body({ parallel_tool_calls: true }), config({ capabilities: { ...catalog().capabilities, parallelTools: false } }), /parallel tools is not supported/)
  rejected(body({ tools: [{ type: 'function', function: { name: 'x', strict: true } }] }), config({ capabilities: { ...catalog().capabilities, strictTools: false } }), /strict tools is not supported/)
})

test('tool schemas, names, IDs, arguments and result order are never rewritten', () => {
  const request = body({
    tools: [{ type: 'function', function: { name: 'mcp__Odd__tool', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }],
    messages: [
      { role: 'assistant', tool_calls: [
        { id: 'B', type: 'function', function: { name: 'mcp__Odd__tool', arguments: '{"query":"β"}' } },
        { id: 'A', type: 'function', function: { name: 'mcp__Odd__tool', arguments: '{"query":"a"}' } },
      ] },
      { role: 'tool', tool_call_id: 'A', content: 'second' },
      { role: 'tool', tool_call_id: 'B', content: 'first' },
    ],
  })
  const before = JSON.stringify(request)
  route(request, config())
  assert.equal(JSON.stringify(request), before)
})

test('all recognized media require explicit modality and full-item context bounds', () => {
  const parts = [
    { modality: 'image', part: { type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } } },
    { modality: 'audio', part: { type: 'input_audio', input_audio: { data: 'Zml4dHVyZQ==', format: 'wav' } } },
    { modality: 'video', part: { type: 'video_url', video_url: { url: 'https://example.invalid/video.mp4' } } },
    { modality: 'file', part: { type: 'file', file: { file_data: 'data:text/plain;base64,Zml4dHVyZQ==' } } },
  ]
  for (const { modality, part } of parts) {
    const request = body({ messages: [{ role: 'user', content: [{ type: 'text', text: 'inspect' }, part] }] })
    assert.doesNotThrow(() => route(request, config()))

    // A tier whose declared modalities exclude the input cannot serve the round. The adaptive
    // alias moves it to a tier that can instead of sending it upstream to fail.
    const limited = config({ capabilities: { ...catalog().capabilities, inputModalities: ['text'] } })
    const rerouted = route(request, limited)
    assert.equal(rerouted.tier, 'other')
    assert.equal(rerouted.rule, 'capability')
    assert.match(rerouted.reason, new RegExp(`input needs text\\+${modality}`))

    // With no tier able to serve the input, the mismatch is a hard failure — never a silent
    // downgrade to a model that would drop the media.
    const noneCapable = validateConfig({
      upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
      models: { cheap: catalog({ capabilities: { ...catalog().capabilities, inputModalities: ['text'] } }) },
      aliases: { 'sabi-code': 'auto' },
      policy: { 'first-turn': 'cheap', unclassified: 'cheap' },
      compatibility: { mode: 'strict' },
    })
    rejected(request, noneCapable, /input modality .* is not supported/)

    // The tier that would serve it still owes a full-item context bound for every medium it accepts.
    const accounting = catalog().contextAccounting!
    const noBound = validateConfig({
      upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
      models: { cheap: catalog({ contextAccounting: { ...accounting, mediaTokens: {} } }) },
      aliases: { 'sabi-code': 'auto' },
      policy: { 'first-turn': 'cheap', unclassified: 'cheap' },
      compatibility: { mode: 'strict' },
    })
    rejected(request, noBound, /context token bound .* is unknown/)
  }
})

test('media routing takes the first tier in configuration order that can accept the input', () => {
  const image = body({
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/i.png' } }] }],
  })
  const textOnly: ModelCapabilities = { ...catalog().capabilities, inputModalities: ['text'] }
  const settings = validateConfig({
    upstreams: { mock: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false } },
    models: {
      cheapest: catalog({ model: 'synthetic-cheapest', capabilities: textOnly }),
      middle: catalog({ model: 'synthetic-middle', capabilities: { ...catalog().capabilities, inputModalities: ['text', 'image'] } }),
      strong: catalog({ model: 'synthetic-strong' }),
    },
    aliases: { 'sabi-code': 'auto', 'sabi-fixed': 'cheapest' },
    policy: { 'first-turn': 'cheapest', unclassified: 'cheapest' },
    compatibility: { mode: 'strict' },
  })
  const decision = route(image, settings)
  assert.equal(decision.tier, 'middle')
  assert.equal(decision.rule, 'capability')

  // A fixed alias is an explicit choice: it does not silently upgrade, it refuses.
  rejected({ ...image, model: 'sabi-fixed' }, settings, /input modality .* is not supported/)
})
test('fixed aliases promote only when the requested output exceeds the selected tier', () => {
  const settings = config({ maxOutputTokens: 100 })
  settings.models.other = catalog({ model: 'synthetic-other', maxOutputTokens: 400 })
  const request = body({ model: 'sabi-fixed', max_tokens: 300 })
  const decision = route(request, settings)
  assert.equal(decision.mode, 'fixed')
  assert.equal(decision.tier, 'other')
  assert.equal(decision.rule, 'output-capacity')
  assert.match(decision.reason, /requested output 300 exceeds 'cheap' maxOutputTokens 100/)
  assert.doesNotThrow(() => ensureRouteCompatible(request, settings, decision))
})

test('unknown parts and unsupported output modalities fail instead of being dropped', () => {
  rejected(body({ messages: [{ role: 'user', content: [{ type: 'provider_blob', value: 'opaque' }] }] }), config(), /content part type is unknown/)
  rejected(body({ modalities: ['image'] }), config(), /output modality 'image' is not supported/)
  assert.doesNotThrow(() => route(body({ modalities: ['text', 'audio'], audio: { voice: 'fixture', format: 'wav' } }), config()))
})

test('structured output mode is checked independently of tools', () => {
  for (const format of [{ type: 'json_object' }, { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object' }, strict: true } }]) {
    const request = body({ response_format: format })
    assert.doesNotThrow(() => route(request, config()))
    rejected(request, config({ capabilities: { ...catalog().capabilities, structuredOutput: [] } }), /structured output is not supported/)
  }
  rejected(body({ response_format: { type: 'json_schema' } }), config(), /requires a schema/)
})

test('effort and both reasoning wire forms are checked without normalization or silent fallback', () => {
  for (const request of [body({ reasoning_effort: 'high' }), body({ reasoning: { effort: 'low', exclude: false } }), body({ reasoning: { max_tokens: 40 } })]) {
    const before = structuredClone(request)
    assert.doesNotThrow(() => route(request, config()))
    assert.deepEqual(request, before)
  }
  rejected(body({ reasoning_effort: 'medium' }), config(), /reasoning effort is not supported/)
  rejected(body({ reasoning: { effort: 'high' } }), config({ capabilities: { ...catalog().capabilities, reasoningEfforts: undefined } }), /reasoning effort capability is unknown/)
  rejected(body({ reasoning_effort: 'high', reasoning: { effort: 'low' } }), config(), /one reasoning control form/)
  rejected(body({ reasoning: { unknown: true } }), config(), /reasoning parameter is not supported/)
  rejected(body({ reasoning: { max_tokens: 101 } }), config(), /reasoning token budget exceeds/)
})

test('strict mode rejects unknown wire parameters and preserves declared extensions unchanged', () => {
  rejected(body({ provider_knob: true }), config(), /provider_knob.*not declared supported/)
  const request = body({ provider_knob: { custom: 1 } })
  const settings = config()
  settings.models.cheap!.capabilities!.supportedParameters!.push('provider_knob')
  const before = structuredClone(request)
  assert.doesNotThrow(() => route(request, settings))
  assert.deepEqual(request, before)
})

test('provider-specific reasoning history requires a declared field and a fixed alias', () => {
  const request = body({ messages: [{ role: 'assistant', content: 'done', reasoning_details: [{ type: 'fixture', data: 'opaque' }] }] })
  rejected(request, config(), /reasoning history requires a fixed alias/)
  assert.doesNotThrow(() => route({ ...request, model: 'sabi-fixed' }, config()))
  rejected({ ...request, model: 'sabi-fixed' }, config({ capabilities: { ...catalog().capabilities, supportedParameters: ['max_tokens'] } }), /messages.reasoning_details.*not declared supported/)
})

test('fixed alias rejects incompatibility instead of routing to an eligible other tier', () => {
  const request = body({ model: 'provider/sabi-fixed', reasoning_effort: 'high' })
  rejected(request, config({ capabilities: { ...catalog().capabilities, reasoningEfforts: [] } }), /reasoning effort is not supported/)
  const settings = config()
  const decision = route(request, settings)
  const other = settings.models.other!
  assert.throws(() => ensureRouteCompatible(request, settings, {
    ...decision, tier: 'other', model: 'other', upstream: other.upstream, upstreamModel: other.model,
  }), /fixed alias cannot change backend/)
})

test('a post-judge backend is checked again with the same request', () => {
  const request = body({ reasoning_effort: 'high' })
  const settings = config()
  const decision = route(request, settings)
  settings.models.other!.capabilities!.reasoningEfforts = ['low']
  const next = { ...decision, tier: 'other', model: 'other', upstreamModel: 'synthetic-other' }
  assert.throws(() => ensureRouteCompatible(request, settings, next), /reasoning effort is not supported/)
  assert.equal(decision.tier, 'cheap')
})

test('output limit is finite, bounded, unambiguous and reserves catalog maximum when omitted', () => {
  for (const value of [0, -1, 1.5, Infinity, NaN, '100', null]) {
    rejected(body({ max_tokens: value }), config(), /output token limit must be/)
  }
  rejected(body({ max_tokens: 2001 }), config(), /exceeds maxOutputTokens/)
  rejected(body({ max_completion_tokens: 100 }), config(), /one output token limit/)
  assert.doesNotThrow(() => route(body({ max_tokens: undefined, max_completion_tokens: 100 }), config()))
  const request = body({ max_tokens: undefined })
  const settings = config({ contextWindow: 2000 })
  rejected(request, settings, /context plus output reserve exceeds/)
})

test('context accounting includes UTF-8 bytes, system prompt, tool schemas, history and output reserve', () => {
  const request = body({
    tools: [{ type: 'function', function: { name: 'x', parameters: { description: 'schema'.repeat(60) } } }],
    messages: [{ role: 'system', content: 'system'.repeat(40) }, { role: 'user', content: '漢🙂' }],
  })
  const bound = Buffer.byteLength(JSON.stringify(request), 'utf8') + 8 + 2 * 4 + 100
  const settings = config({ contextWindow: bound, maxOutputTokens: 100 })
  assert.doesNotThrow(() => route(request, settings))
  settings.models.cheap!.contextWindow = bound - 1
  rejected(request, settings, /context plus output reserve exceeds/)
})

test('strict mode fails clearly for unknown limits or accounting assumptions', () => {
  for (const [field, pattern] of [
    ['contextWindow', /contextWindow is unknown/],
    ['maxOutputTokens', /maxOutputTokens is unknown/],
    ['contextAccounting', /contextAccounting is unknown/],
  ] as const) {
    const settings = config()
    delete settings.models.cheap![field]
    rejected(body(), settings, pattern)
  }
})

test('legacy metadata omissions preserve current callers, but explicit negatives still reject', () => {
  const settings = config()
  delete settings.compatibility
  settings.models.cheap = { upstream: 'mock', model: 'legacy' }
  const request = body({ tools: [{ function: { name: 'read_file' } }], reasoning_effort: 'provider-value', unknown_extension: true })
  assert.doesNotThrow(() => route(request, settings))
  settings.models.cheap.capabilities = { tools: false }
  rejected(request, settings, /tools is not supported/)
})

test('bad request shape and prototype-derived aliases fail as route errors', () => {
  for (const request of [null, [], 'request']) assert.throws(() => route(request as unknown as ChatRequestBody, config()), SabiRouteError)
  rejected(body({ messages: 'bad' }), config(), /messages must be an array/)
  assert.throws(() => route(body({ model: 'toString' }), config()), (error: unknown) => error instanceof SabiRouteError && error.status === 404)
})


test('opaque provider file and audio references require a fixed backend', () => {
  const file = body({ messages: [{ role: 'user', content: [{ type: 'file', file: { file_id: 'provider-id' } }] }] })
  rejected(file, config(), /file reference requires a fixed alias/)
  assert.doesNotThrow(() => route({ ...file, model: 'sabi-fixed' }, config()))
  const audio = body({ messages: [{ role: 'assistant', content: null, audio: { id: 'provider-audio' } }] })
  const settings = config()
  settings.models.cheap!.capabilities!.supportedParameters!.push('messages.audio')
  rejected(audio, settings, /audio history requires a fixed alias/)
  assert.doesNotThrow(() => route({ ...audio, model: 'sabi-fixed' }, settings))
})

test('null limits and modality lists cannot masquerade as absent fields', () => {
  rejected(body({ max_tokens: undefined, max_completion_tokens: null }), config(), /output token limit must be/)
  rejected(body({ modalities: null }), config(), /modalities must be a nonempty array/)
})

test('adaptive mode promotes when the planned tier cannot satisfy the output reserve', () => {
  const settings = config()
  settings.compatibility = { mode: 'legacy' }
  settings.models.cheap = { upstream: 'mock', model: 'legacy', maxOutputTokens: 50 }
  const decision = route(body(), settings)
  assert.equal(decision.tier, 'other')
  assert.equal(decision.rule, 'output-capacity')
  assert.match(decision.reason, /requested output 100 exceeds 'cheap' maxOutputTokens 50/)
  assert.doesNotThrow(() => route(body({ max_tokens: 50, unknown_extension: true }), settings))
})


test('strict compatibility validates injected stream usage options before forwarding', () => {
  const settings = config()
  settings.upstreams.mock!.streamUsage = true
  settings.models.cheap!.capabilities!.supportedParameters = []
  const request = body({ stream: true, max_tokens: undefined })
  const before = structuredClone(request)
  rejected(request, settings, /stream_options.*not declared supported/)
  assert.deepEqual(request, before)
  settings.models.cheap!.capabilities!.supportedParameters.push('stream_options')
  const decision = route(request, settings)
  const forwarded = buildEffectiveRequestEnvelope(settings, decision, request)
  assert.deepEqual(forwarded.stream_options, { include_usage: true })
  assert.equal(forwarded.model, decision.upstreamModel)
  assert.deepEqual(request, before)
})

test('exact context boundary uses the backend id and generated fields, not the input alias', () => {
  const request = body({ model: 'sabi-fixed', stream: true, stream_options: { include_usage: false, fixture: 'kept' } })
  const original = structuredClone(request)
  const settings = config({ model: `synthetic-${'long-backend-id-'.repeat(20)}` })
  settings.upstreams.mock!.streamUsage = true
  const decision = route(request, settings)
  const forwarded = buildEffectiveRequestEnvelope(settings, decision, request)
  const framingAndOutput = 8 + 4 + 100
  const required = Buffer.byteLength(JSON.stringify(forwarded), 'utf8') + framingAndOutput
  const inboundBound = Buffer.byteLength(JSON.stringify(request), 'utf8') + framingAndOutput
  assert.ok(required > inboundBound)
  settings.models.cheap!.contextWindow = required
  settings.models.cheap!.maxOutputTokens = 100
  assert.doesNotThrow(() => ensureRouteCompatible(request, settings, decision))
  assert.doesNotThrow(() => route(request, settings))
  settings.models.cheap!.contextWindow = required - 1
  rejected(request, settings, /context plus output reserve exceeds/)
  settings.models.cheap!.contextWindow = inboundBound
  rejected(request, settings, /context plus output reserve exceeds/)
  assert.equal(decision.mode, 'fixed')
  assert.equal(decision.alias, 'sabi-fixed')
  assert.deepEqual(request, original)
  assert.deepEqual(forwarded.stream_options, { include_usage: true, fixture: 'kept' })
})

test('injected stream_options bytes alone can exceed the exact context boundary', () => {
  const settings = config({ model: 'sabi-code', maxOutputTokens: 100 })
  settings.upstreams.mock!.streamUsage = true
  const request = body({ stream: true })
  const decision = route(request, settings)
  const forwarded = buildEffectiveRequestEnvelope(settings, decision, request)
  const required = Buffer.byteLength(JSON.stringify(forwarded), 'utf8') + 8 + 4 + 100
  settings.models.cheap!.contextWindow = required
  assert.doesNotThrow(() => route(request, settings))
  settings.models.cheap!.contextWindow = required - 1
  rejected(request, settings, /context plus output reserve exceeds/)
  assert.equal(request.stream_options, undefined)
})

test('server and compatibility use the same pure envelope builder', async () => {
  const server = await import('../../server/src/upstream.ts')
  assert.equal(server.buildUpstreamBody, buildEffectiveRequestEnvelope)
  const settings = config()
  settings.upstreams.mock!.streamUsage = true
  const request = body({ stream: true, stream_options: { include_usage: false } })
  Object.freeze(request.stream_options)
  Object.freeze(request)
  const decision = route(request, settings)
  const forwarded = server.buildUpstreamBody(settings, decision, request)
  assert.notEqual(forwarded, request)
  assert.notEqual(forwarded.stream_options, request.stream_options)
  assert.deepEqual(request.stream_options, { include_usage: false })
  assert.deepEqual(forwarded.stream_options, { include_usage: true })
})

test('malformed stream options cannot be normalized into a valid envelope', () => {
  const settings = config()
  settings.upstreams.mock!.streamUsage = true
  for (const stream_options of [null, [], 'invalid', 1, { include_usage: 'yes' }]) {
    rejected(body({ stream: true, stream_options }), settings, /stream_options/)
  }
})

test('a free-models-only upstream refuses a priced model and reroutes to a zero-priced one', () => {
  const free = { baseURL: 'http://127.0.0.1:1/v1', apiKey: '$KEY', paidModelsAllowed: false }
  const settings = validateConfig({
    upstreams: { free, open: { baseURL: 'http://127.0.0.1:2/v1', apiKey: '$KEY' } },
    models: {
      cheap: catalog({ upstream: 'free', model: 'some/model:free', cost: { input: 0, output: 0 } }),
      strong: catalog({ upstream: 'free', model: 'some/paid-model', cost: { input: 0.5, output: 1 } }),
      unpriced: catalog({ upstream: 'free', model: 'some/unpriced-model' }),
      open: catalog({ upstream: 'open', model: 'some/paid-model' }),
    },
    aliases: {
      'sabi-code': 'auto', 'sabi-strong': 'strong', 'sabi-unpriced': 'unpriced', 'sabi-open': 'open',
    },
    policy: { 'first-turn': 'strong', unclassified: 'strong' },
    compatibility: { mode: 'strict' },
  })

  // The rule is a hard constraint, not a preference: the priced policy tier is skipped for the
  // cheapest zero-priced tier that can still serve the round, and the decision names why.
  const decision = route(body(), settings)
  assert.equal(decision.tier, 'cheap')
  assert.equal(decision.rule, 'billing')
  assert.match(decision.reason, /free-models-only/)

  // A fixed alias names its backend explicitly: it refuses instead of silently downgrading.
  rejected(body({ model: 'sabi-strong' }), settings, /free-models-only and 'some\/paid-model' is not zero-priced/)
  // An undeclared price is unknown, and unknown is not free.
  rejected(body({ model: 'sabi-unpriced' }), settings, /is not zero-priced/)
  // An upstream that does not declare the rule is unaffected.
  assert.equal(route(body({ model: 'sabi-open' }), settings).tier, 'open')
})

test('a disabled upstream is rejected before dispatch, independent of compatibility mode', () => {
  for (const mode of ['strict', 'legacy'] as const) {
    const settings = config()
    settings.compatibility = { mode }
    settings.upstreams.mock!.enabled = false
    rejected(body(), settings, /upstream 'mock' is disabled/)
  }
})

test('an adaptive round whose policy tier sits behind a disabled upstream reroutes to another enabled tier', () => {
  const settings = validateConfig({
    upstreams: {
      down: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false, enabled: false },
      up: { baseURL: 'http://127.0.0.1:2/v1', apiKey: false },
    },
    models: {
      cheap: catalog({ upstream: 'down', model: 'blocked' }),
      other: catalog({ upstream: 'up', model: 'synthetic-other' }),
    },
    aliases: { 'sabi-code': 'auto', 'sabi-fixed': 'cheap' },
    policy: { unclassified: 'cheap' },
    compatibility: { mode: 'strict' },
  })
  const decision = route(body(), settings)
  assert.equal(decision.tier, 'other')
  assert.equal(decision.rule, 'availability')
  assert.match(decision.reason, /upstream for 'cheap'.*is disabled.*'other' can serve/)

  // A fixed alias never upgrades — it names its backend explicitly and refuses instead.
  rejected(body({ model: 'sabi-fixed' }), settings, /upstream 'down' is disabled/)
})

test('the unavailable-upstream fallback is cheapest-first, independent of declaration order', () => {
  const priced = (model: string, input: number, output: number, upstream = 'up') =>
    catalog({ upstream, model, cost: { input, output } })
  const base = {
    upstreams: {
      down: { baseURL: 'http://127.0.0.1:1/v1', apiKey: false, enabled: false },
      up: { baseURL: 'http://127.0.0.1:2/v1', apiKey: false },
    },
    aliases: { 'sabi-code': 'auto' },
    policy: { unclassified: 'cheap' },
    compatibility: { mode: 'strict' },
  }
  const orderA = validateConfig({
    ...base,
    models: {
      cheap: priced('blocked', 0.1, 0.1, 'down'),
      strong: priced('synthetic-strong', 9, 9),
      mid: priced('synthetic-mid', 1, 1),
    },
  })
  const orderB = validateConfig({
    ...base,
    models: {
      strong: priced('synthetic-strong', 9, 9),
      mid: priced('synthetic-mid', 1, 1),
      cheap: priced('blocked', 0.1, 0.1, 'down'),
    },
  })
  const routedA = route(body(), orderA)
  const routedB = route(body(), orderB)
  assert.equal(routedA.tier, 'mid', 'cheapest enabled tier wins even when declared last')
  assert.equal(routedB.tier, 'mid', 'same tier set in a different order resolves the same way')
  assert.equal(routedA.rule, 'availability')
  assert.equal(routedB.rule, 'availability')
})
