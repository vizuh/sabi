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
  function?: { name?: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean }
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

export type ModelModality = 'text' | 'image' | 'audio' | 'video' | 'file'

/** Operator-verified capabilities for this exact upstream/model pair. Omission means unknown. */
export interface ModelCapabilities {
  tools?: boolean
  parallelTools?: boolean
  strictTools?: boolean
  inputModalities?: ModelModality[]
  outputModalities?: ModelModality[]
  structuredOutput?: Array<'json_object' | 'json_schema'>
  reasoningEfforts?: string[]
  /** Accepted wire parameters beyond model/messages/stream. No parameters are silently removed. */
  supportedParameters?: string[]
}

/**
 * Operator-supplied upper-bound assumptions, not a tokenizer or measured usage. Strict
 * mode requires these assumptions for the selected model's tokenizer/framing and each item. Media
 * bounds must cover the full accepted size/detail/duration, not just the URL or base64 text.
 */
export interface ContextAccounting {
  textTokensPerByte: number
  requestOverheadTokens: number
  perMessageOverheadTokens: number
  mediaTokens?: Partial<Record<Exclude<ModelModality, 'text'>, number>>
}

export interface ModelEntry {
  upstream: string
  model: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities?: ModelCapabilities
  contextAccounting?: ContextAccounting
  cost?: CostRates
}

export interface CompatibilityConfig {
  /** Omitted mode preserves the existing Command Code proxy behavior, without a fit guarantee. */
  mode: 'legacy' | 'strict'
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
  compatibility?: CompatibilityConfig
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
  /** True only when an explicit client session was provided; absent means legacy/unknown. */
  sessionKnown?: boolean
  /** Server-generated request identity, independent of session grouping. */
  requestId?: string
  client?: 'hermes' | 'opencode' | 'kilo-cli' | 'kilo-vscode' | 'prime-agent' | 'unknown'
  /** Hashed client turn identity; never raw prompt text or credentials. */
  turnId?: string
  /** Observed upstream model only when it matches a configured model identifier. */
  servedModel?: string
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
}
