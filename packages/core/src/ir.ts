import type {
  AdapterKind,
  CacheObservation,
  EvidenceCode,
  ExecutionCapabilities,
  ExecutionReceipt,
  FailureLevel,
  RoundKind,
  TrajectoryEvidence,
  TrajectoryIR,
  TrajectoryState,
  VerificationState,
} from './types.ts'

export type AdapterShape = 'proxy' | 'mod' | 'native'

export interface TrajectoryIRInput {
  shape: AdapterShape
  roundId: string
  harness: AdapterKind
  state: TrajectoryState
  known: {
    session: boolean
    turn: boolean
    capabilities: boolean
  }
  cache?: CacheObservation
  receipt?: ExecutionReceipt
  verification?: VerificationState
}

/** The evidence codes a host may emit into the IR. Anything else is refused. */
const ALLOWED_EVIDENCE: Set<EvidenceCode> = new Set<EvidenceCode>([
  'error-line',
  'python-traceback',
  'panic',
  'exception',
  'typescript-error',
  'fail-marker',
  'command-failed',
  'nonzero-exit',
  'failure-count',
  'command-not-found',
  'permission-denied',
  'missing-file',
  'soft-warning',
  'soft-deprecated',
  'soft-retrying',
  'soft-timeout',
  'tool-error',
  'permission-denial',
  'rate-limited',
  'quota-exceeded',
  'timeout',
  'connection-closed',
  'mutation',
  'verification-receipt',
  'summary-claim',
  'scope-observed',
  'constraint',
  'prior-failure',
  'context-boundary',
  'observation',
])

/**
 * Translate one host round into the normalized Trajectory IR.
 *
 * The shape is an input, never a derived fact: proxy, mod and native shapes
 * carrying the same observable state must produce the same IR. Fields a host
 * cannot supply are listed in `untranslatable` and read as absent — never as
 * an invented default.
 */
export function toTrajectoryIR(input: TrajectoryIRInput): TrajectoryIR {
  const state = input.state
  const untranslatable: string[] = []

  const evidence: TrajectoryEvidence[] = []
  for (const code of (state.failureEvidence ?? []) as EvidenceCode[]) {
    if (!ALLOWED_EVIDENCE.has(code)) {
      throw new Error(`refused unallowlisted evidence code '${String(code)}' in TrajectoryIR`)
    }
    evidence.push({
      code,
      source: 'harness',
      status: 'observed',
      contextGeneration: state.contextGeneration ?? 0,
    })
  }

  let capabilities: ExecutionCapabilities | undefined
  if (!input.known.capabilities) {
    untranslatable.push('capabilities')
  }

  return {
    roundId: input.roundId,
    harness: input.harness,
    kind: state.roundKind,
    failureLevel: state.failure,
    evidence,
    verification: input.verification,
    capabilities,
    cache: input.cache,
    receipt: input.receipt,
    untranslatable,
  }
}