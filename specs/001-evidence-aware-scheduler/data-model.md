# Data Model: Evidence-Aware Adaptive Scheduler

The model is additive. Existing records keep their current fields and receive
optional fields so old decision logs remain readable.

## TrajectoryEvidence

Represents one bounded claim used by a route or recovery decision.

| Field | Type | Rules |
|---|---|---|
| `code` | allowlisted evidence code | Never arbitrary raw text. |
| `source` | `tool` \| `user` \| `harness` \| `judge` \| `summary` | Identifies who/what produced it. |
| `status` | `observed` \| `verified` \| `unverified` \| `contradicted` | Summary/inferred sources cannot self-upgrade to verified. |
| `contextGeneration` | non-negative integer | Matches the compaction generation where known. |
| `detail` | bounded sanitized string, optional | Omitted by default; never credentials or raw transcript. |

## VerificationState

| Field | Type | Rules |
|---|---|---|
| `status` | `not-required` \| `needed` \| `attempted` \| `passed` \| `failed` \| `unknown` | `passed`/`failed` require an explicit receipt or deterministic tool evidence. |
| `reason` | allowlisted code, optional | Explains why verification is needed or unknown. |
| `receiptId` | bounded identifier, optional | Links to an execution/tool receipt, never a secret. |
| `generation` | non-negative integer, optional | Prevents stale results crossing compaction. |

Transitions are conservative:

```text
not-required ────────────────┐
                              ├─> attempted ──> passed / failed
mutation ──> needed ─────────┘
unknown ──> attempted / needed; summary alone never reaches passed
```

## ScopeCoverage

| Field | Type | Rules |
|---|---|---|
| `expected` | non-negative integer, optional | Explicit requested scope when available. |
| `observed` | non-negative integer, optional | Tool/harness observations deduplicated by stable identity. |
| `ratio` | number 0..1, optional | Present only when expected is positive and observed is known. |
| `source` | `explicit` \| `inferred` \| `unknown` | Inferred coverage cannot satisfy an explicit threshold by itself. |
| `missing` | bounded identifiers, optional | Sanitized names or stable labels only. |

## RecoveryObservation

| Field | Type | Rules |
|---|---|---|
| `failureSignature` | bounded stable string | Derived from allowlisted evidence, not raw output. |
| `stateFingerprint` | bounded stable string | Includes relevant state generation and operation facts. |
| `action` | RecoveryAction | Must be code-generated and allowlisted. |
| `route` | model/harness identity, optional | Observed target only; no unverified capability claim. |
| `outcome` | `recovered` \| `failed` \| `unknown` | Completion requires a separate verification/receipt gate. |
| `evidenceGrade` | `observed` \| `matched` \| `replayed` | Grades causality, not task quality. |
| `contextGeneration` | non-negative integer | Prevents cross-compaction attribution. |
| `receiptId` | bounded identifier, optional | Required for replayed evidence. |

## RecoveryAction

```text
continue
retry-same
retry-with-feedback
gather-evidence
escalate-model
fresh-context
rollback-with-reflection
ask-user
```

The planner returns an action, reason code, valid route constraints, and an
optional bounded capsule. It does not choose an unbounded free-form action.

## RecoveryCapsule

| Field | Type | Rules |
|---|---|---|
| `failureSignature` | bounded string | Links to the failed episode. |
| `verifiedFacts` | bounded list of evidence items | Only receipt-backed facts are verified. |
| `attemptedApproaches` | bounded list of labels | No full transcript. |
| `verifiedNonSolutions` | bounded list of labels | Must carry provenance/status. |
| `lastKnownCleanPoint` | bounded label, optional | No raw worktree diff. |
| `recommendedNextAction` | RecoveryAction, optional | Still subject to target capability gates. |
| `sourceGeneration` | non-negative integer, optional | Marks compaction boundary. |

## JudgeEvidence

One bounded decision payload contains at most one current item per slot:

- intent
- latest failure/observation
- latest mutation
- latest verification
- unresolved constraint
- prior failed approach
- context boundary

Missing slots are represented as absent/unknown, not filled with guessed text.

## SemanticEpisode and ProfileCandidate

`SemanticEpisode` normalizes an operation into task class, model, harness,
environment, outcome, cost, latency, coverage, verification, and evidence-grade
fields. `ProfileCandidate` aggregates comparable episodes and carries sample
count, backtest/holdout results, gate status (`shadow`, `backtested`, `active`,
or `rejected`), and rollback reference. A candidate has no effect on active
routing while it is `shadow` or `backtested`.
