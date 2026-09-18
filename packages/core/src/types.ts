export type FailureLevel = 'none' | 'soft' | 'hard' | 'transport'

export type RoundKind = 'first-turn' | 'exploration' | 'implementation' | 'verification' | 'unclassified'

/**
 * Allowlisted failure-evidence codes. These are the only values that may appear in
 * `TrajectoryState.failureEvidence` and in decision-log reasons — never raw excerpts.
 * Diagnostic snippets are an explicit opt-in via `telemetry.captureSnippets`.
 */
export type EvidenceCode =
  | 'error-line'
  | 'python-traceback'
  | 'panic'
  | 'exception'
  | 'typescript-error'
  | 'fail-marker'
  | 'command-failed'
  | 'nonzero-exit'
  | 'failure-count'
  | 'command-not-found'
  | 'permission-denied'
  | 'missing-file'
  | 'soft-warning'
  | 'soft-deprecated'
  | 'soft-retrying'
  | 'soft-timeout'
  | 'tool-error'
  | 'permission-denial'
  | 'rate-limited'
  | 'quota-exceeded'
  | 'timeout'

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
  /** Full request context estimate (transcript + tool schemas + system prompt) when known, else the same as `contextChars` (unknown). */
  contextTokens?: number
  contextKnown?: boolean
  hasTools: boolean
  toolNames: string[]
  lastToolNames: string[]
  roundKind: RoundKind
  failure: FailureLevel
  /** Allowlisted evidence codes only; never raw snippets. */
  failureEvidence: string[]
  /** Same failure as an earlier round, without a successful/interceding turn. */
  repeatedFailure?: boolean
  /** Count of consecutive rounds (this one included) with the same failure signature. */
  failureStreak?: number
  /** Finite model context window for the tier that would serve this round, if the catalog is explicit. */
  contextWindow?: number
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

export interface JudgeThresholds {
  realProblem?: number
  veto?: number
  difficultyConfidence?: number
}

export interface JudgeConfig {
  enabled: boolean
  baseURL: string
  apiKey?: string | false
  model?: string
  timeoutMs?: number
  cacheTtlMs?: number
  callOn?: string[]
  thresholds?: JudgeThresholds
  maxStateChars?: number
  costPerMTokInput?: number
}

export interface CatalogTier {
  model: string
  effort?: string
  minPlan?: string
  contextWindow?: number
}

export interface TelemetryConfig {
  /** Record evidence codes only. Default: true. Diagnostic excerpts never leave the host by default. */
  allowlistOnly?: boolean
  /** Opt-in: persist up to `captureChars` of the reasoning evidence used to route. Default: 800. */
  captureSnippets?: boolean
  captureChars?: number
}

export interface SabiConfig {
  provenance?: string
  server?: { host?: string; port?: number }
  upstreams: Record<string, UpstreamEntry>
  models: Record<string, ModelEntry>
  aliases: Record<string, string>
  policy: Record<string, string>
  judge?: JudgeConfig
  telemetry?: TelemetryConfig
  harness?: {
    provenance?: string
    tiers: Record<string, CatalogTier>
    contextWindow?: number
  }
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

export interface JudgeRecord {
  status: 'ok' | 'error' | 'timeout'
  model?: string
  latencyMs?: number
  cached?: boolean
  realProblem?: number
  difficulty?: string
  difficultyConfidence?: number
  originalTier?: string
  finalTier?: string
  overridden?: boolean
  direction?: 'down' | 'up'
  note?: string
  usage?: { inputTokens: number; outputTokens: number }
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
  judge?: JudgeRecord
  usage?: UsageTotals
  cost?: CostBreakdown
  latencyMs?: number
  ttftMs?: number
  outcome: 'ok' | 'error' | 'aborted' | 'transport'
  error?: string
  /** HTTP status of a transport/rate-limit failure from the upstream, when it was recorded that way. */
  transport?: number
  /** Opaque Sabi-generated id for this request; set on the response and on the decision. */
  requestId: string
  /** Opaque client-supplied identifiers, when the harness forwards them. Never used to merge sessions. */
  clientRequestId?: string
  clientSessionId?: string
}
