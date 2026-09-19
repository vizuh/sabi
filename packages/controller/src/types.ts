export type ControllerAction = 'CONTINUE' | 'DELEGATE' | 'SPAWN' | 'ORCHESTRATE' | 'ASK'

/** Allowlisted trigger ids only — never the raw request substring that matched. */
export type MultiScopeKeyword = 'multiple-projects' | 'multiple-repos' | 'across-projects' | 'coordinate' | 'orchestrate'

export type OrcaErrorCode = 'binary-not-found' | 'timeout' | 'nonzero-exit' | 'invalid-json' | 'unrecognized-shape'

export interface OrcaQueryResult {
  ok: boolean
  /** Present only when ok; shape unverified against a real orca-ide install — see orca.ts. */
  worktrees?: unknown[]
  terminals?: unknown[]
  errorCode?: OrcaErrorCode
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
  ts: string
  cwd: string
  signals: ControllerSignals
}
