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
  | 'connection-closed'
  | 'mutation'
  | 'verification-receipt'
  | 'summary-claim'
  | 'scope-observed'
  | 'constraint'
  | 'prior-failure'
  | 'context-boundary'
  | 'observation'

export type EvidenceSource = 'tool' | 'user' | 'harness' | 'judge' | 'summary'
export type EvidenceStatus = 'observed' | 'verified' | 'unverified' | 'contradicted'
export type VerificationStatus = 'not-required' | 'needed' | 'attempted' | 'passed' | 'failed' | 'unknown'
export type VerificationReason =
  | 'mutation-without-receipt'
  | 'summary-without-receipt'
  | 'stale-generation'
  | 'invalid-receipt'
  | 'missing-receipt'
  | 'scope-unknown'
  | 'user-denial'
  | 'contradicted'
  | 'verification-receipt'
  | 'verification-receipt'
export type ScopeCoverageSource = 'explicit' | 'inferred' | 'unknown'

export interface ScopeCoverage {
  expected?: number
  observed?: number
  ratio?: number
  source: ScopeCoverageSource
  missing?: string[]
}

export interface TrajectoryEvidence {
  code: EvidenceCode
  source: EvidenceSource
  status: EvidenceStatus
  contextGeneration: number
  detail?: string
}

export interface VerificationReceipt {
  id: string
  status: Extract<VerificationStatus, 'passed' | 'failed'>
  generation: number
  source: Exclude<EvidenceSource, 'summary' | 'judge'>
  valid?: boolean
}

export interface VerificationState {
  status: VerificationStatus
  reason?: VerificationReason
  receiptId?: string
  generation?: number
}

/**
 * Deterministic execution outcome sources. A receipt records what a verifier or
 * deterministic operation reported — never what a model claimed about it.
 */
export type ExecutionReceiptSource =
  | 'test'
  | 'build'
  | 'lint'
  | 'edit'
  | 'git'
  | 'repo-map'
  | 'sandbox'

export type ExecutionReceiptStatus = 'passed' | 'failed' | 'unknown'

/**
 * Shared cross-cutting execution receipt (spec 002). All fields are bounded and
 * sanitized: fingerprints instead of contents, file names instead of paths,
 * explicit `unknown` instead of invented defaults.
 */
export interface ExecutionReceipt {
  /** Stable idempotency key: duplicate deliveries with the same id merge. */
  operationId: string
  source: ExecutionReceiptSource
  status: ExecutionReceiptStatus
  startedAt: number
  durationMs: number
  inputFingerprint?: string
  outputFingerprint?: string
  /** Changed file names only — never absolute paths or contents. */
  changedFiles?: string[]
  /** Verifier identity (tool/command label), when a verifier produced this. */
  verifier?: string
  exitCode?: number
  expectedScope?: number
  observedScope?: number
  /** True when the run succeeded but covered the wrong target. */
  scopeMismatch?: boolean
  isolation?: {
    workspaceId: string
    disposable: boolean
  }
}

/**
 * Tri-state harness capability flag. `unknown` (or omission) MUST NOT enable
 * receipt-dependent actions — only an explicit `true` does.
 */
export type CapabilityFlag = boolean | 'unknown'

/**
 * Per-harness declared evidence surface (spec 002). Sabi consumes these
 * declarations; it never probes beyond the supported extension surface, and
 * unknown harnesses read as all-`unknown`.
 */
export interface ExecutionCapabilities {
  repoMap?: CapabilityFlag
  incrementalContext?: CapabilityFlag
  deterministicEdit?: CapabilityFlag
  isolatedWorkspaces?: CapabilityFlag
  verifierReceipts?: CapabilityFlag
  eventDrivenChanges?: CapabilityFlag
}

export interface ScopeInput {
  expected?: string[] | number
  observed?: string[] | number
  source?: ScopeCoverageSource
  missing?: string[]
}

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
  /** Optional host metadata. These fields are bounded and never contain transcript text. */
  requestedScope?: string[]
  observedScope?: string[]
  scope?: ScopeInput
  verificationReceipt?: VerificationReceipt
  /** Structured execution receipt (spec 002); validated before it can close verification. */
  executionReceipt?: ExecutionReceipt
  contextGeneration?: number
  summaryClaim?: boolean
  [key: string]: unknown
}

export interface TrajectoryState {
  messageCount: number
  assistantTurns: number
  toolMessages: number
  lastRole: string
  contextChars: number
  estimatedTokens: number
  /**
   * Full request context when it is measured: the provider's billed total for the previous round
   * of this session, floored at the character estimate. Absent means unknown — a character
   * estimate is never promoted to a measured size.
   */
  contextTokens?: number
  contextKnown?: boolean
  /**
   * How many times the host has rewritten (compacted) this session's transcript before this
   * round. A boundary invalidates pre-rewrite judgments and restarts the failure streak.
   */
  contextGeneration?: number
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
  /**
   * Input modalities this request actually carries, `text` first. A wire-level caller that sees the
   * whole body states the full set; a harness that can only look for positive evidence omits the
   * field entirely rather than claiming a text-only round.
   */
  inputModalities?: ModelModality[]
  /** Media content parts found in the request, by kind. */
  mediaCounts?: Partial<Record<Exclude<ModelModality, 'text'>, number>>
  /** Bounded allowlisted claims carried by the current trajectory. */
  evidence?: TrajectoryEvidence[]
  verification?: VerificationState
  scopeCoverage?: ScopeCoverage
}

export type RecoveryAction =
  | 'continue'
  | 'retry-same'
  | 'retry-with-feedback'
  | 'gather-evidence'
  | 'escalate-model'
  | 'fresh-context'
  | 'rollback-with-reflection'
  | 'ask-user'
  | 'verify-local'
  | 'rollback'
  | 'switch-harness'

export type RecoveryReasonCode =
  | 'none'
  | 'transport'
  | 'hard-failure'
  | 'missing-evidence'
  | 'repeated-failure'
  | 'user-denial'
  | 'invalid-receipt'
  | 'exhausted-routes'
  | 'unsupported-capability'
  | 'stale-generation'
  | 'no-safe-continuation'
  | 'verified'
  | 'needs-verification'
  | 'clean-point'

export interface RecoveryRouteConstraint {
  excludeRoutes?: string[]
  excludeProviders?: string[]
  requireCapability?: string
}

export interface RecoveryPlan {
  action: RecoveryAction
  reason: RecoveryReasonCode
  constraints?: RecoveryRouteConstraint
  retryable: boolean
  source: 'deterministic' | 'judge'
}

export interface RecoveryPlannerInput {
  state: TrajectoryState
  verification?: VerificationState
  userDenied?: boolean
  invalidReceipt?: boolean
  exhaustedRoutes?: boolean
  unsupportedCapability?: boolean
  retriesRemaining?: number
  availableRoutes?: string[]
  currentRoute?: string
  currentProvider?: string
  safeRollback?: boolean
  hasFeedback?: boolean
  /** Pinned-at-plan-time capability snapshot; omission means all-unknown (001 behavior). */
  capabilities?: ExecutionCapabilities
  /** Bounded clean-point label from a current-generation capsule; required for `rollback`. */
  cleanPoint?: string
  /** An alternate harness with declared capabilities is registered; enables `switch-harness`. */
  alternateCapableHarness?: boolean
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
  /** Kill switch. Omitted or true: usable. False: schema stays valid, but nothing may route or dispatch to it. */
  enabled?: boolean
  /**
   * Operator billing rule. Omitted or true: any declared model may route here. False: only
   * zero-priced models may route or dispatch to this upstream — a model whose price is unknown
   * or non-zero is refused, so a config mistake cannot spend money on a free-only upstream.
   */
  paidModelsAllowed?: boolean
  /**
   * Borrowed authentication. `passthrough` means this upstream holds no credential of its own:
   * the request is forwarded with the credential the harness already sent, to the provider that
   * credential belongs to. Sabi stores nothing, logs nothing, and never opens a credential file.
   */
  auth?: 'passthrough'
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
  /**
   * Explicit opt-in for raw prompt/tool-excerpt egress to the judge endpoint.
   * Default follows `telemetry.captureSnippets`: absent/false means the judge
   * receives hashed tool identity, evidence codes and shape (lengths/hashes),
   * never raw instruction or tool-output text.
   */
  includeSnippets?: boolean
}

export interface CatalogTier {
  model: string
  effort?: string
  minPlan?: string
  contextWindow?: number
  /** Operator-verified input modalities for this exact catalog model. Omission means unknown. */
  inputModalities?: ModelModality[]
}

export interface TelemetryConfig {
  /** Record evidence codes only. Default: true. Diagnostic excerpts never leave the host by default. */
  allowlistOnly?: boolean
  /** Opt-in: persist up to `captureChars` of the reasoning evidence used to route. Default: 800. */
  captureSnippets?: boolean
  captureChars?: number
}

export interface ControllerHarnessConfig {
  preferredModels?: string[]
}

export interface ControllerHarnessRoutingConfig {
  /**
   * When true, the controller prefers to spawn/delegate to a harness whose live model
   * catalog exposes at least one explicit-free worker model (e.g. `opencode/muse-…-free`),
   * as a tie-breaker after capacity but before static preference order. Sessions without a
   * catalog are treated as neutral (score 0). This never overrides capacity gating — a
   * quota-exhausted harness with free models still loses to a healthy one without.
   *
   * The score counts free worker models in the catalog, so more free options outrank fewer.
   * Gated so a missing catalog does not cause a regression: score 0 = no penalty.
   */
  useFreeCatalog?: boolean
}

export interface ControllerConfig {
  preferredHarnesses?: string[]
  harnesses?: Record<string, ControllerHarnessConfig>
  harnessRouting?: ControllerHarnessRoutingConfig
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
  controller?: ControllerConfig
  harness?: {
    provenance?: string
    tiers: Record<string, CatalogTier>
    contextWindow?: number
  }
  /**
   * Opt-in retry of transport failures (429/402/403) on the next serving tier.
   * Omitted or false: the first upstream error is served as-is (current behavior).
   */
  transportFallback?: {
    enabled?: boolean
  }
  /**
   * Borrowed harness authentication. `alias` names the adaptive alias whose policy serves rounds
   * that arrive in a harness's native wire format; the incoming model id is the harness's own label
   * and is not an alias. Defaults to `sabi-code` when that alias is adaptive.
   *
   * `models`/`policy` let a borrowed round route through its own tier set instead of the top-level
   * `models`/`policy` every other harness shares. Without this, wiring a passthrough upstream (e.g.
   * Anthropic, for Claude Code's own credential) means repointing the shared `cheap`/`mid`/`strong`
   * tiers — which breaks free routing for every OpenAI-compatible harness using the same tiers.
   * Omitted: falls back to the top-level `models`/`policy`, current behavior unchanged.
   */
  passthrough?: {
    alias?: string
    models?: Record<string, ModelEntry>
    policy?: Record<string, string>
  }
}

export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
}

export type CacheStatus = 'hit' | 'miss' | 'unknown'

export interface CacheObservation {
  status: CacheStatus
  promptTokens?: number
  cachedTokens?: number
}

export type CacheRoutingPhase = 'same-tool-cycle' | 'new-phase' | 'failure' | 'escalation' | 'unknown'
export type CacheRoutingAction = 'keep' | 'evaluate' | 'switch'

/** Bounded routing evidence; costs are provider-rate units (USD per token after /1e6). */
export interface CacheRoutingDecision {
  action: CacheRoutingAction
  phase: CacheRoutingPhase
  cacheStatus: CacheStatus
  plannedTier: string
  selectedTier: string
  previousTier?: string
  estimatedContextTokens?: number
  cachedTokens?: number
  reprocessTokens?: number
  expectedGain?: number
  cachePenalty?: number
  reason: string
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
  recovery?: RecoveryPlan
  cache?: CacheRoutingDecision
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
  /** Shadow question: probability the last tool result is redundant for the next step. Recorded, never applied. */
  evidenceRedundant?: number
  originalTier?: string
  finalTier?: string
  overridden?: boolean
  direction?: 'down' | 'up'
  note?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export type EffortSource = 'client' | 'scheduled' | 'unspecified'

export interface DecisionRecord {
  ts: string
  sessionId: string
  /** True only when an explicit client session was provided; absent means legacy/unknown. */
  sessionKnown?: boolean
  /** Server-generated request identity, independent of session grouping. */
  requestId?: string
  /** Where the recorded reasoning effort came from. `scheduled` is reserved for a future
   * effort-scheduling slice; only `client` and `unspecified` are written today. */
  effortSource?: EffortSource
  /** Client-requested reasoning effort for this round, when exactly one control form named one.
   * Record-only: Sabi never injects or rewrites it today. */
  effort?: string
  client?: 'hermes' | 'opencode' | 'kilo-cli' | 'kilo-vscode' | 'prime-agent' | 'deepseek-harness' | 'command-code' | 'sabi-surplus' | 'unknown'
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
  cache?: CacheRoutingDecision
  judge?: JudgeRecord
  usage?: UsageTotals
  cost?: CostBreakdown
  latencyMs?: number
  ttftMs?: number
  outcome: 'ok' | 'error' | 'aborted' | 'transport'
  error?: string
  /** HTTP status of a transport/rate-limit failure from the upstream, when it was recorded that way. */
  transport?: number
  /** Tier that served the round after a transport-fallback retry, when the planned tier failed first. */
  fallback?: string
  /** Optional graded recovery attribution; legacy records omit it. */
  recovery?: RecoveryObservation
}

export type RecoveryEvidenceGrade = 'observed' | 'matched' | 'replayed'
export type RecoveryOutcome = 'recovered' | 'failed' | 'unknown'

export interface RecoveryObservation {
  failureSignature: string
  stateFingerprint: string
  action: RecoveryAction
  route?: string
  outcome: RecoveryOutcome
  evidenceGrade: RecoveryEvidenceGrade
  contextGeneration: number
  receiptId?: string
}

export type EpisodePhase = 'pre' | 'live' | 'post'
export type EpisodeResult = 'recovered' | 'failed' | 'incomplete' | 'unknown'
export type EpisodeEvidenceSource = 'fixture' | 'source-test' | 'ci' | 'live-runtime'

export interface SemanticEpisode {
  id?: string
  phase: EpisodePhase
  operation: string
  taskClass?: string
  model?: string
  harness?: string
  provider?: string
  effort?: string
  environment?: string
  result: EpisodeResult
  verification?: VerificationState
  coverage?: ScopeCoverage
  recovery?: RecoveryObservation
  usage?: UsageTotals
  cost?: number
  latencyMs?: number
  evidence: EpisodeEvidenceSource
}

export type ShadowLifecycle = 'shadow' | 'backtested' | 'active' | 'rejected' | 'rolled-back'

export interface ProfileCandidate {
  id: string
  operation: string
  model?: string
  harness?: string
  sampleCount: number
  minimumSamples: number
  status: ShadowLifecycle
  backtest?: { passed: boolean; holdoutPassed?: boolean; reason?: string }
  rollbackReference?: string
}

export type JudgeEvidenceSlotName =
  | 'intent'
  | 'mutation'
  | 'failure'
  | 'verification'
  | 'constraint'
  | 'priorFailure'
  | 'contextBoundary'

export interface JudgeEvidenceValue {
  status: EvidenceStatus | 'unknown'
  value?: string
  source?: EvidenceSource
  contextGeneration?: number
}

export interface JudgeEvidence {
  intent: JudgeEvidenceValue
  mutation: JudgeEvidenceValue
  failure: JudgeEvidenceValue
  verification: JudgeEvidenceValue
  constraint: JudgeEvidenceValue
  priorFailure: JudgeEvidenceValue
  contextBoundary: JudgeEvidenceValue
  omitted: JudgeEvidenceSlotName[]
}

/**
 * Normalized adapter manifest (spec 005). A manifest is a declaration, not a
 * capability probe: Sabi consumes it, never verifies it against a live host.
 * Unknown fields read as `unknown`; the adapter is still loadable.
 */
export type AdapterKind =
  | 'command-code'
  | 'opencode'
  | 'hermes'
  | 'oh-my-pi'
  | 'prime-agent'
  | 'deepseek-harness'
  | 'orca'
  | 'claude-code'
  | 'codex'
  | 'unknown'

export interface AdapterManifest {
  id: string
  kind: AdapterKind
  version: string
  /** Adapter's own loop / runtime contract. Sabi never forks or patches it. */
  loop: 'native' | 'proxy' | 'mod'
  /** Declared evidence surface. Absence = all unknown. */
  evidence?: ExecutionCapabilities
  /** Explicitly declared, never inferred. */
  capabilities?: AdapterCapability[]
  /** Refused surfaces. A declared refusal beats a silent absence. */
  refusals?: AdapterRefusal[]
}

export interface AdapterCapability {
  key: string
  declared: boolean
}

export interface AdapterRefusal {
  surface: string
  reason: string
}

/**
 * Switching affinity. `required` means the host MUST NOT switch on its own;
 * `preferred` is a cache/economics hint that still permits a switch; `none`
 * leaves the decision to cost/capability/effort/failure/quality/latency.
 */
export type ContinuityLock = 'none' | 'preferred' | 'required'

/**
 * Normalized Trajectory IR (spec 005). Every harness/runtime emits one of these
 * per round; translators map host events onto it. Fields a host cannot supply
 * read as `unknown` — never as an invented default.
 */
export interface TrajectoryIR {
  roundId: string
  harness: AdapterKind
  kind: RoundKind
  failureLevel: FailureLevel
  /** Bounded, allowlisted codes only. */
  evidence: TrajectoryEvidence[]
  verification?: VerificationState
  capabilities?: ExecutionCapabilities
  cache?: CacheObservation
  receipt?: ExecutionReceipt
  /** Fields the host could not translate. Never silently dropped. */
  untranslatable: string[]
}

/**
 * Normalized decision envelope (spec 005). One per planned round; the refusal
 * record is the failure mode, not a missing envelope.
 */
export interface DecisionEnvelope {
  envelopeId: string
  roundId: string
  harness: AdapterKind
  action: RecoveryAction
  reasonCode: RecoveryReasonCode
  /** Ordered fallback chain. Empty = refuse. */
  fallback: RecoveryAction[]
  /** The model/provider this envelope serves; retained when a field is refused. */
  model: string
  upstream: string
  effort?: string
  /** Bounded deadline in ms, when one was planned. Absent = no deadline. */
  deadlineMs?: number
  /** Switching affinity. `required` binds the host; `preferred` is a hint. */
  lock: ContinuityLock
  /** Deterministic, never a model claim. */
  verification?: VerificationState
  capabilities?: ExecutionCapabilities
  refused?: AdapterRefusal
}

export type ConformanceVerdict =
  | 'conformant'
  | 'lossy'
  | 'unstable'
  | 'leaking'
  | 'refused'

export interface ConformanceCheck {
  id: string
  name: string
  /** Pure function of the IR and manifest; no host interaction. */
  check: (ir: TrajectoryIR, manifest: AdapterManifest) => boolean
}

export interface ConformanceReport {
  reportId: string
  adapterId: string
  generatedAt: string
  verdict: ConformanceVerdict
  checks: ConformanceCheckResult[]
  /** Bounded. */
  untranslatable: string[]
}

export interface ConformanceCheckResult {
  checkId: string
  verdict: ConformanceVerdict
  detail?: string
}

/**
 * Shadow routing mirror (spec 010). One record per routed round; the mirror
 * observes Sabi's own decision and the candidate set it considered. It never
 * intercepts, reroutes, or influences execution — collection only, labeled as
 * such, never presented as a benchmark.
 */
export interface ProposedRoute {
  tier: string
  upstream: string
  upstreamModel: string
}

export interface CandidateRoute extends ProposedRoute {
  score?: number
}

export type ShadowDivergence = 'none' | 'proposed-differs' | 'no-proposal'

export interface ShadowRecord {
  kind: 'shadow'
  ts: string
  sessionId: string
  mode: 'shadow' | 'backtested'
  actual: ProposedRoute
  proposed: ProposedRoute[]
  candidates: CandidateRoute[]
  divergence: ShadowDivergence
  divergenceReason?: string
  state: TrajectoryState
  rule: string
  tier: string
  outcome: string
}

export interface RetentionPolicy {
  maxRecords: number
  /** Oldest records are compacted first; export happens before compaction. */
  exportFirst: boolean
  dropAccounting: boolean
}

export interface MetricSample {
  ts: string
  value: number
  /** Bounded label set; never raw strings. */
  labels: Record<string, string>
}

export interface MetricSeries {
  name: string
  unit: string
  samples: MetricSample[]
}
