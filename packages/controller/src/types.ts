import type { EvidenceSource, EvidenceStatus, RecoveryAction } from '@sabi/core'

export type ControllerAction = 'CONTINUE' | 'DELEGATE' | 'SPAWN' | 'ORCHESTRATE' | 'ASK'

/** Allowlisted trigger ids only — never the raw request substring that matched. */
export type MultiScopeKeyword = 'multiple-projects' | 'multiple-repos' | 'across-projects' | 'coordinate' | 'orchestrate'

export type OrcaErrorCode =
  | 'binary-not-found'
  | 'timeout'
  | 'nonzero-exit'
  | 'invalid-json'
  | 'unrecognized-shape'
  | 'command-failed'

export interface OrcaQueryResult {
  ok: boolean
  /** Present only when ok; shape unverified against a real orca-ide install — see orca.ts. */
  worktrees?: unknown[]
  terminals?: unknown[]
  errorCode?: OrcaErrorCode
  detail?: string
}

export type AgentCapacityStatus = 'available' | 'degraded' | 'rate_limited' | 'quota_exhausted' | 'unavailable'

export interface AgentCapacity {
  status: AgentCapacityStatus
  /** Unix epoch in milliseconds. */
  resetAt?: number
  remainingPct?: number
  fallbackMode?: 'lower_priority' | 'cheaper_model'
}

export type AgentLifecycle = 'active' | 'idle' | 'blocked' | 'waiting' | 'dead'

export type HarnessModelCostClass = 'explicit-free' | 'unknown'
export type HarnessModelRole = 'worker' | 'judge'

export interface HarnessModelHealth {
  status: 'healthy' | 'unavailable' | 'unknown'
  sampleCount: number
  successCount: number
  failureCount: number
  lastOutcome: 'ok' | 'failed' | 'unverifiable'
  lastLatencyMs?: number
  observedAt: number
}

/**
 * Runtime evidence from a harness-owned model catalog. A missing sourceRevision is intentional:
 * most installed CLIs expose a version but not the repository commit that generated the catalog.
 */
export interface HarnessModelDescriptor {
  id: string
  costClass: HarnessModelCostClass
  role: HarnessModelRole
}

export interface HarnessCatalogDescriptor {
  command: string
  runtimeVersion?: string
  outputSha256: string
  observedAt: number
  sourceRevision?: string
  modelCount: number
  truncated?: boolean
  models: HarnessModelDescriptor[]
}

export interface AgentDescriptor {
  id: string
  agent: string
  harness: string
  capabilities: string[]
  available: boolean
  capacity: AgentCapacity
  worktree?: string
  branch?: string
  /** Bounded, non-transcript context such as an Orca title or harness identity. */
  context?: string
  /** Selected/launch model when the local harness catalog made it explicit. */
  model?: string
  lastOutputAt?: number
}

export interface AgentSession extends AgentDescriptor {
  kind: 'session'
  handle?: string
  /** False when the host owns continuation and no external terminal transport exists. */
  dispatchable?: boolean
  lifecycle: AgentLifecycle
  authenticated?: boolean
  failureStreak?: number
}

export interface AgentHarness extends AgentDescriptor {
  kind: 'harness'
  command: string
  /** Command with a verified local model selection, when configured. */
  launchCommand?: string
  /** Bounded runtime catalog evidence; presence does not prove plan entitlement or health. */
  catalog?: HarnessCatalogDescriptor
  /** Process-local receipt health for the selected model; absence means no observation yet. */
  modelHealth?: HarnessModelHealth
}

/** A distilled, provenance-tagged claim; never a raw transcript excerpt. */
export interface RecoveryCapsuleItem {
  label: string
  status: EvidenceStatus
  source: EvidenceSource
}

/**
 * Compact cross-context handoff (contract: controller-capsule.md). Distilled facts and labels
 * only — no transcript, prompt, credential, or unbounded diff. The execution receipt,
 * idempotency key, target identity, and outcome stay outside this shape by construction.
 */
export interface RecoveryCapsule {
  failureSignature: string
  verifiedFacts: RecoveryCapsuleItem[]
  attemptedApproaches: string[]
  verifiedNonSolutions: RecoveryCapsuleItem[]
  lastKnownCleanPoint?: string
  /** Advisory only — still subject to target capability/capacity gates in agents.ts. */
  recommendedNextAction?: RecoveryAction
  sourceGeneration?: number
}

export interface HandoffSnapshot {
  objective: string
  originalRequest: string
  sourceSession: string
  repo: string
  progress: string
  workCompleted: string
  changedFiles: string[]
  /** Bounded phase plan carried to a replacement model/harness. */
  currentPlan?: string[]
  /** Tool identities only; never raw tool arguments or output. */
  toolsExecuted?: string[]
  /** Bounded failure labels and prior attempts. */
  failures?: string[]
  branch: string
  worktree: string
  testsRun: string[]
  /** Verification commands/results kept separate from task progress. */
  verifications?: string[]
  latestResults: string[]
  unresolvedWork: string[]
  latestFailure?: string
  relevantDiff: string
  nextAction: string
  recoveryCapsule?: RecoveryCapsule
}

export interface AgentRoutingCosts {
  handoffMs: number
  replacementExecutionMs: number
  /** A rate limit beyond this wait is a hard delegation trigger. */
  rateLimitThresholdMs: number
}

export interface AgentRoutingInput {
  now: number
  active: AgentSession
  existingSessions: AgentSession[]
  spawnCandidates: AgentHarness[]
  preferredHarnesses?: string[]
  requiredCapabilities: string[]
  costs: AgentRoutingCosts
  handoff: HandoffSnapshot
  /** Opt-in tie-breaker: prefer candidates whose live catalog exposes free worker models. */
  useFreeCatalog?: boolean
}

export type AgentRouteAction = 'CONTINUE' | 'DELEGATE' | 'SPAWN' | 'ASK'

export interface AgentRoutePlan {
  action: AgentRouteAction
  rule: string
  reason: string
  currentEligible: boolean
  eligibleAgentIds: string[]
  handoff: HandoffSnapshot
  target?: AgentSession | AgentHarness
  estimatedWaitMs?: number
  reconsiderAt?: number
  transferCostMs: number
}

export interface ControllerOverride {
  sessionId?: string
  harness?: string
}

export type ControllerExecutionStatus =
  | 'not-started'
  | 'started'
  | 'completed'
  | 'failed'
  | 'rerouted'
  | 'awaiting-user'
  | 'unverifiable'

export type ControllerReceiptPhase = 'accepted' | 'started' | 'completed' | 'failed' | 'unknown'

export interface ControllerExecutionReceipt {
  phase: ControllerReceiptPhase
  observedAt: string
  requestId?: string
}

export interface ControllerExecution {
  status: ControllerExecutionStatus
  durationMs?: number
  targetId?: string
  terminalHandle?: string
  operation?: 'terminal-send' | 'terminal-spawn' | 'orchestration'
  requestId?: string
  runId?: string
  dispatchId?: string
  idempotencyKey?: string
  model?: string
  modelHealth?: HarnessModelHealth
  receipt?: ControllerExecutionReceipt
  inputAccepted?: boolean
  turnStarted?: boolean
  requestObserved?: boolean
  waitSatisfied?: boolean
  observedStatus?: string
  observedOutputLines?: number
  outputCursor?: number | string
  reroutedFrom?: string
  rerouteCount?: number
  retryable?: boolean
  error?: string
}

export interface JevDecisionTelemetry {
  status: 'not-consulted' | 'skipped' | 'ok' | 'error'
  validActions: ControllerAction[]
  selectedAction?: ControllerAction
  model?: string
  cached?: boolean
  latencyMs?: number
  error?: string
}

export interface ControllerCandidateTelemetry {
  action: 'CONTINUE' | 'DELEGATE' | 'SPAWN'
  id: string
  agent: string
  kind: 'session' | 'harness'
  available: boolean
  dispatchable?: boolean
  capacity: AgentCapacity
  lifecycle?: AgentLifecycle
  context?: string
  model?: string
  catalog?: HarnessCatalogDescriptor
  modelHealth?: HarnessModelHealth
}

export interface ControllerRoutingTelemetry {
  inventory: {
    orcaAvailable: boolean
    worktreeCount: number
    sessionCount: number
    harnessCount: number
    activeSessionId?: string
    observedAt: number
    cached: boolean
  }
  validActions: ControllerAction[]
  candidates: ControllerCandidateTelemetry[]
  decisionSource: 'deterministic' | 'jev' | 'override'
  deterministicRule: string
  jev: JevDecisionTelemetry
}

export interface ControllerSignals {
  cwd: string
  requestGiven: boolean
  multiScope: boolean
  /** How multiScope was decided — an explicit flag always wins over the keyword heuristic. */
  multiScopeTrigger?: 'flag' | MultiScopeKeyword
  gitClean?: boolean
  stuckSession: boolean
  /** Count of own-log rows considered for the stuck-session check (recency window) — 0 means no
   * recent history, not "no log ever". */
  sabiLogSampled: number
  orcaAvailable: boolean
  orcaErrorCode?: OrcaErrorCode
  matchingWorktree: boolean
  matchingTerminal: boolean
}

export interface ControllerDecision {
  action: ControllerAction
  rule: string
  reason: string
}

export interface ControllerDecisionRecord extends ControllerDecision {
  traceVersion?: 1
  ts: string
  cwd: string
  signals: ControllerSignals
  request?: string
  requestLength?: number
  idempotencyKey?: string
  override?: ControllerOverride
  handoff?: HandoffSnapshot
  target?: AgentSession | AgentHarness
  routing?: ControllerRoutingTelemetry
  execution?: ControllerExecution
}
