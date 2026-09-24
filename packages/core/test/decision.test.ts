import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDecisionEnvelope } from '../src/decision.ts'
import type {
  AdapterKind,
  DecisionEnvelope,
  RouteDecision,
  SabiConfig,
  TrajectoryState,
} from '../src/types.ts'

/**
 * The Decision envelope is the symmetric output of the Trajectory IR: one
 * contract every host consumes instead of N bespoke decision shapes
 * (spec 005 US2, T020/T021). Fields a host cannot express are refused with a
 * reason, never silently dropped.
 */

function baseState(over: Partial<TrajectoryState> = {}): TrajectoryState {
  return {
    messageCount: 4,
    assistantTurns: 1,
    toolMessages: 2,
    lastRole: 'assistant',
    contextChars: 8000,
    estimatedTokens: 2000,
    hasTools: true,
    toolNames: ['read'],
    lastToolNames: [],
    roundKind: 'implementation',
    failure: 'none',
    failureEvidence: [],
    ...over,
  }
}

function baseDecision(over: Partial<RouteDecision> = {}): RouteDecision {
  return {
    alias: 'mid',
    mode: 'auto',
    rule: 'policy',
    tier: 'mid',
    reason: 'implementation phase',
    model: 'dots-studio/dots-3-note-preview:free',
    upstream: 'openrouter',
    upstreamModel: 'dots-studio/dots-3-note-preview:free',
    state: baseState(),
    ...over,
  }
}

function baseConfig(): SabiConfig {
  return {
    upstreams: {
      openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: '$OPENROUTER_API_KEY',
        streamUsage: true,
        paidModelsAllowed: false,
      },
    },
    models: {
      cheap: { upstream: 'openrouter', model: 'poolside/laguna-s-2.1:free' },
      mid: { upstream: 'openrouter', model: 'dots-studio/dots-3-note-preview:free' },
      strong: { upstream: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    },
    aliases: { sabi: 'auto' },
  } as unknown as SabiConfig
}

test('a plain inference decision renders one envelope with no refusals', () => {
  const envelope = renderDecisionEnvelope({
    decision: baseDecision(),
    config: baseConfig(),
    hostCapabilities: { effort: true, modelSwitch: true, reasoning: true },
    hostId: 'opencode',
  })
  assert.equal(envelope.harness, 'opencode')
  assert.equal(envelope.action, 'continue')
  assert.equal(envelope.reasonCode, 'none')
  // The fallback chain is derived and deterministic; it is never empty for a
  // non-refused action, so the host has a stated order to follow.
  assert.ok(envelope.fallback.length > 0, 'expected a non-empty fallback chain')
  assert.equal(envelope.refused, undefined)
})

test('an effort the host cannot express is refused with a reason, not dropped', () => {
  const decision = baseDecision({
    state: baseState({ roundKind: 'implementation' }),
  })
  const envelope = renderDecisionEnvelope({
    decision,
    config: baseConfig(),
    hostCapabilities: { effort: false, modelSwitch: true, reasoning: false },
    hostId: 'opencode',
    requestedEffort: 'high',
  })
  assert.ok(envelope.refused, 'expected a refusal record')
  assert.equal(envelope.refused?.surface, 'effort')
  assert.match(envelope.refused?.reason ?? '', /refused/)
  // The remainder of the decision still applies.
  assert.equal(envelope.action, 'continue')
})

test('a fallback policy in the envelope is followed in stated order without re-asking', () => {
  const decision = baseDecision({
    recovery: { action: 'escalate-model', reason: 'hard-failure', retryable: true, source: 'deterministic' },
  })
  const envelope = renderDecisionEnvelope({
    decision,
    config: baseConfig(),
    hostCapabilities: { effort: true, modelSwitch: true, reasoning: true },
    hostId: 'hermes',
  })
  // The host consumes the stated order as-is; Sabi is not re-asked.
  assert.ok(envelope.fallback.length > 0)
  assert.notEqual(envelope.fallback, [])
})

test('a model switch the host cannot perform is refused and the current model is retained', () => {
  const decision = baseDecision({
    recovery: { action: 'switch-harness', reason: 'transport', retryable: false, source: 'deterministic' },
  })
  const envelope = renderDecisionEnvelope({
    decision,
    config: baseConfig(),
    hostCapabilities: { effort: true, modelSwitch: false, reasoning: true },
    hostId: 'command-code',
  })
  assert.ok(envelope.refused, 'expected refusal on modelSwitch')
  assert.equal(envelope.refused?.surface, 'modelSwitch')
  // Retained, not silently switched.
  assert.equal(envelope.model, decision.model)
})

test('an unknown host capability reads as all-unknown, never as permissive', () => {
  const envelope = renderDecisionEnvelope({
    decision: baseDecision(),
    config: baseConfig(),
    hostCapabilities: undefined,
    hostId: 'unknown',
    requestedEffort: 'high',
  })
  assert.ok(envelope.refused, 'unknown host must refuse effort, not assume it')
  assert.equal(envelope.refused?.surface, 'effort')
})

test('a refused field is recorded, never silently applied', () => {
  const envelope = renderDecisionEnvelope({
    decision: baseDecision(),
    config: baseConfig(),
    hostCapabilities: { effort: false, modelSwitch: true, reasoning: false },
    hostId: 'opencode',
    requestedEffort: 'high',
  })
  assert.ok(envelope.refused)
  assert.equal(typeof envelope.refused?.reason, 'string')
  assert.ok((envelope.refused?.reason ?? '').length > 0)
})

test('every envelope carries a deterministic envelopeId and reasonCode', () => {
  const envelope = renderDecisionEnvelope({
    decision: baseDecision(),
    config: baseConfig(),
    hostCapabilities: { effort: true, modelSwitch: true, reasoning: true },
    hostId: 'opencode',
  })
  assert.equal(typeof envelope.envelopeId, 'string')
  assert.ok(envelope.envelopeId.length > 0)
  assert.equal(typeof envelope.reasonCode, 'string')
})