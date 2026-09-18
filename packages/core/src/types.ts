export type FailureLevel = 'none' | 'soft' | 'hard'

export type RoundKind = 'first-turn' | 'exploration' | 'implementation' | 'verification' | 'unclassified'

export interface ChatToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

export interface ChatMessage {
  role?: string
  content?: unknown
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatToolDef {
  type?: string
  function?: { name?: string }
}

export interface ChatRequestBody {
  model?: string
  messages?: ChatMessage[]
  tools?: ChatToolDef[]
  stream?: boolean
  stream_options?: Record<string, unknown>
  [key: string]: unknown
}

export interface TrajectoryState {
  messageCount: number
  assistantTurns: number
  toolMessages: number
  lastRole: string
  contextChars: number
  estimatedTokens: number
  hasTools: boolean
  toolNames: string[]
  lastToolNames: string[]
  roundKind: RoundKind
  failure: FailureLevel
  failureEvidence: string[]
}

export interface CostRates {
  input: number
  output: number
  cacheRead?: number
}

export interface ModelEntry {
  upstream: string
  model: string
  contextWindow?: number
  cost?: CostRates
}

export interface UpstreamEntry {
  baseURL: string
  apiKey?: string | false
  headers?: Record<string, string>
  streamUsage?: boolean
}

export interface SabiConfig {
  provenance?: string
  server?: { host?: string; port?: number }
  upstreams: Record<string, UpstreamEntry>
  models: Record<string, ModelEntry>
  aliases: Record<string, string>
  policy: Record<string, string>
}

export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
}

export interface RouteDecision {
  alias: string
  mode: 'auto' | 'fixed'
  rule: string
  tier: string
  reason: string
  model: string
  upstream: string
  upstreamModel: string
  state: TrajectoryState
}

export interface CostBreakdown {
  input: number
  output: number
  total: number
}

export interface DecisionRecord {
  ts: string
  sessionId: string
  alias: string
  mode: 'auto' | 'fixed'
  rule: string
  tier: string
  reason: string
  upstream: string
  upstreamModel: string
  stream: boolean
  state: TrajectoryState
  usage?: UsageTotals
  cost?: CostBreakdown
  latencyMs?: number
  ttftMs?: number
  outcome: 'ok' | 'error' | 'aborted'
  error?: string
}
