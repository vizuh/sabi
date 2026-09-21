# Feature Specification: Evidence-Aware Adaptive Scheduler

**Feature Branch**: `001-evidence-aware-scheduler`

**Created**: 2026-09-20

**Status**: Planned

**Input**: User-provided research synthesis from a 1,200-paper September 18,
2026 arXiv CS screening and a request to make Sabi an evidence-aware trajectory
controller rather than a tier-only classifier.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve evidence across a trajectory (Priority: P1)

As an agent host, I need Sabi to represent verification, provenance, scope
coverage, and compaction boundaries explicitly so that a summary or handoff
cannot silently turn an unverified claim into a verified fact.

**Why this priority**: Every later recovery or learning decision depends on the
quality and status of the state it receives.

**Independent Test**: Feed state-building helpers tool, user, summary, and
compaction events; assert bounded structured evidence, monotonic safety status,
coverage, and context generation without raw transcript persistence.

**Acceptance Scenarios**:

1. **Given** a code mutation with no subsequent verifier receipt, **when** the
   trajectory is summarized, **then** verification is `needed` or `unknown`,
   never `passed`.
2. **Given** a summary that says “tests pass” without a tool receipt, **when**
   it crosses a compaction or handoff boundary, **then** the claim remains
   `unverified` and records its summary source.
3. **Given** an explicit verifier receipt, **when** the receipt is attached to
   the same state generation, **then** the status may become `passed` or
   `failed` with the receipt source and bounded details.

---

### User Story 2 - Choose a recovery action before a model (Priority: P1)

As a user running a coding task, I need Sabi to decide whether to gather
evidence, retry, repair, escalate, start fresh, roll back with reflection, or
ask me before it selects a model or harness.

**Why this priority**: A stronger model is only one possible intervention and is
often the wrong response to provider failure, missing evidence, or contaminated
context.

**Independent Test**: Evaluate the deterministic recovery planner against a
fixture matrix for hard failure, transport failure, missing evidence, repeated
failure, user denial, and unknown receipts; assert one valid bounded action.

**Acceptance Scenarios**:

1. **Given** a provider quota or rate-limit signal, **when** recovery is planned,
   **then** Sabi chooses a retry or route-removal action and does not spend a
   stronger tier on the same unavailable provider.
2. **Given** a failed implementation with a bounded verifier result, **when**
   recovery is planned, **then** Sabi can choose feedback-driven repair or model
   escalation and records the reason.
3. **Given** a contaminated or repeated-failure trajectory, **when** no safe
   continuation exists, **then** Sabi chooses a fresh-context or rollback action
   with a bounded capsule, not an unbounded transcript copy.

---

### User Story 3 - Give the judge minimal sufficient evidence (Priority: P1)

As a routing decision, I need state-conditioned evidence slots rather than only
the last excerpt, while keeping hard deterministic gates ahead of any judge call.

**Why this priority**: The judge must see the facts needed for the next decision,
not merely text that happens to be recent or lexically relevant.

**Independent Test**: Build judge state from fixtures containing intent, mutation,
failure, verification, constraints, prior failure, and compaction boundaries;
assert required slots are present, bounded, redacted by default, and stable.

**Acceptance Scenarios**:

1. **Given** a hard failure or transport limit, **when** the router evaluates the
   state, **then** the deterministic gate decides without a judge call.
2. **Given** an unclassified round, **when** judge state is built, **then** it
   contains the smallest available items for intent, latest failure or
   observation, verification, unresolved constraint, and prior failed approach.
3. **Given** oversized or unavailable evidence, **when** the state is bounded,
   **then** omission is explicit as `unknown` and no raw secret or credential is
   introduced.

---

### User Story 4 - Attribute recovery with graded evidence (Priority: P1)

As a Sabi maintainer, I need recovery records to distinguish temporal
observation, matched-state evidence, and replay validation so that learning does
not mistake “the next round was clean” for causal proof.

**Why this priority**: Incorrect credit assignment can poison future routing and
is more dangerous than a conservative cold start.

**Independent Test**: Run deterministic recovery fixtures with identical state
fingerprints and different actions; assert grades and outcome attribution remain
separate in records and reports.

**Acceptance Scenarios**:

1. **Given** a failure followed by a clean next round, **when** an episode is
   recorded, **then** its evidence grade is `observed`.
2. **Given** comparable captured states with repeated outcomes, **when** a route
   is compared, **then** the record may be `matched` but is not `replayed`.
3. **Given** an explicit side-effect-safe replay fixture, **when** the candidate
   improves the same captured state, **then** the record is `replayed` and keeps
   the replay receipt separate from the original run.

---

### User Story 5 - Prevent false completion with verification and coverage (Priority: P2)

As a user asking an agent to inspect or change a scope, I need Sabi to record how
much requested scope was actually observed and whether the result was verified.

**Why this priority**: A confident “done” is not a reliable outcome when files,
tests, or requested checks were skipped.

**Independent Test**: Feed explicit and inferred file scopes plus tool reads and
verifier results; assert coverage ratios, unknown cases, and completion gates.

**Acceptance Scenarios**:

1. **Given** 20 explicitly requested files and 13 observed reads, **when** the
   episode closes, **then** coverage is 13/20 and completion is not treated as
   fully verified.
2. **Given** no explicit scope, **when** coverage is inferred, **then** its
   source is `inferred` and cannot satisfy an explicit required threshold
   without a policy decision.
3. **Given** a verifier exits successfully but the mutation scope is unknown,
   **when** completion is assessed, **then** the missing scope remains visible.

---

### User Story 6 - Carry a compact recovery capsule across controller handoffs (Priority: P2)

As a controller, I need `SPAWN` and cross-harness handoffs to retain verified
facts, attempted approaches, non-solutions, and the last clean point without
copying a corrupted transcript.

**Why this priority**: Fresh context is useful only if it does not repeat the
same failed approach or lose the constraints already established.

**Independent Test**: Serialize and bound a `RecoveryCapsule` through the
controller handoff path; assert it survives target changes, excludes raw
transcript by default, and remains below the configured handoff limit.

**Acceptance Scenarios**:

1. **Given** a failed session with verified facts and attempted approaches,
   **when** the controller chooses `SPAWN`, **then** the new handoff contains a
   capsule with those bounded fields.
2. **Given** a capsule containing only inferred claims, **when** it is serialized,
   **then** those claims retain their unverified status.
3. **Given** a handoff target with incompatible tools or modalities, **when** the
   capsule is delivered, **then** the controller keeps the capability gate and
   chooses `ASK` or another valid action rather than silently degrading.

---

### User Story 7 - Learn in shadow mode from semantic episodes (Priority: P2)

As a maintainer, I need reports grouped by semantic operation and empirical model
profile, with candidate changes staged through shadow, backtest, and gate states
before they can affect routing.

**Why this priority**: Local evidence is the product differentiator, but unsafe
self-evolution can contaminate all future decisions.

**Independent Test**: Aggregate labelled fixture episodes by operation, model,
harness, outcome, cost, latency, and evidence grade; assert proposed changes are
shadow-only until a deterministic gate accepts them.

**Acceptance Scenarios**:

1. **Given** repeated comparable operations, **when** a report is generated,
   **then** it shows sample count, success/recovery rates, cost/latency, and
   evidence-grade distribution without claiming universal model quality.
2. **Given** a candidate learned rule from insufficient or contaminated data,
   **when** promotion is attempted, **then** it remains shadow or rejected with
   an explicit reason.
3. **Given** a gated profile that later regresses, **when** rollback is invoked,
   **then** deterministic routing remains available and the prior profile is
   recoverable.

---

### User Story 8 - Calibrate development evaluation cheaply (Priority: P3)

As a Sabi maintainer, I need selected development eval subsets and PRE/LIVE/POST
failure labels so router changes can be compared frequently without pretending
that a small offline suite is a product benchmark.

**Why this priority**: Full trajectory evaluation is expensive, but uncalibrated
small samples are misleading.

**Independent Test**: Select a deterministic subset from labelled fixtures,
compare its direction of change with a held-out set, and report inconclusive
results when the subset is not calibrated.

**Acceptance Scenarios**:

1. **Given** a router change and a stable fixture corpus, **when** a subset is
   selected, **then** selection is reproducible from a seed and records its
   population and holdout.
2. **Given** a failure detector, **when** it is evaluated, **then** preflight,
   live, and post-run attribution metrics are reported separately.
3. **Given** no live provider or harness evidence, **when** evals run offline,
   **then** the output labels itself as fixture evidence and makes no savings or
   quality claim.

### Edge Cases

- A round has no mutation, so verification is `not-required`, while a later
  summary incorrectly claims a test passed.
- A verifier exits zero but checks the wrong target, emits contradictory output,
  or produces no machine-readable receipt.
- A compaction occurs between failure and recovery, causing old fingerprints and
  failure streaks to be invalid for causal comparison.
- A provider quota, transport timeout, user denial, or unsupported modality is
  mistaken for a reasoning failure.
- A replay would repeat a destructive command, mutate a shared repository, or
  lacks a safe fixture harness; it must become `unknown`, never run implicitly.
- A state fingerprint collides, a transcript is unavailable, or evidence arrives
  out of order across two processes or harnesses.
- Coverage is explicit in one harness but inferred or unavailable in another,
  and the controller receives a stale handoff capsule.
- The judge returns an unknown, invalid, or stale action, the requested action
  is incompatible with the chosen model, or all eligible routes are exhausted.
- A new model has no history, a model's ability changes after a provider update,
  or a learned profile has too few samples or mixed task semantics.
- The process restarts between an execution request and its receipt, so duplicate
  recovery must be bounded and idempotent.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST represent verification as `not-required`, `needed`,
  `attempted`, `passed`, `failed`, or `unknown` and MUST distinguish a
  verifier receipt from a model claim.
- **FR-002**: Sabi MUST attach evidence provenance with source, status, and
  context generation; summary or inferred evidence MUST NOT silently become
  verified.
- **FR-003**: Sabi MUST represent scope coverage with expected, observed, ratio,
  and source fields when available, and MUST expose unknown coverage explicitly.
- **FR-004**: Sabi MUST choose a bounded recovery action before model/harness
  selection, including continue, retry, feedback repair, evidence gathering,
  escalation, fresh context, rollback with reflection, or ask-user.
- **FR-005**: Deterministic gates MUST take precedence over judge calls for hard
  failures, transport limits, user denial, unsupported capability, invalid
  receipts, and exhausted routes.
- **FR-006**: Judge input MUST use bounded state-conditioned evidence slots for
  intent, mutation, failure, verification, constraints, prior failure, and
  context boundary; absent slots MUST remain unknown.
- **FR-007**: Recovery records MUST include a stable bounded state fingerprint,
  action, outcome, and `observed`, `matched`, or `replayed` evidence grade.
- **FR-008**: Replay validation MUST be explicit, fixture-safe, side-effect-safe,
  separately receipted, and never invoked automatically on live user work.
- **FR-009**: Controller handoffs MUST support a bounded `RecoveryCapsule` with
  verified facts, attempted approaches, verified non-solutions, last clean point,
  and next hypothesis/action.
- **FR-010**: Reports MUST aggregate episodes by semantic operation, model,
  harness, environment, outcome, cost, latency, coverage, verification, and
  evidence grade without presenting local evidence as a universal benchmark.
- **FR-011**: Learned profiles and route changes MUST pass shadow, backtest, and
  deterministic promotion gates; raw logs MUST NOT directly change active policy.
- **FR-012**: Evaluation MUST distinguish PRE, LIVE, and POST failure detection,
  include coverage/verification/recovery fixtures, and label offline results as
  offline evidence.
- **FR-013**: Existing serialized decision records and omitted optional fields
  MUST remain readable; default telemetry MUST remain allowlisted and bounded.
- **FR-014**: The default route MUST remain deterministic, fail open to the host
  harness, and preserve idempotency and receipts across bounded retries.
- **FR-015**: Model/harness choice MUST occur only after capability, modality,
  context, provider, quota, and user-policy gates are satisfied.

### Non-Functional Requirements

- **NFR-001**: Pure state, evidence, coverage, and recovery decisions MUST have
  deterministic outputs for identical inputs.
- **NFR-002**: New evidence and capsule payloads MUST stay within the configured
  judge/handoff character bounds and MUST avoid unbounded transcript scans.
- **NFR-003**: A synthetic 10x traffic run MUST demonstrate bounded memory and no
  more than 10% median overhead in the deterministic routing path compared with
  the pre-feature baseline, excluding external inference latency.
- **NFR-004**: No test or fixture may require paid provider inference, live user
  credentials, or unlabelled external data.

### Key Entities *(include if data involved)*

- **TrajectoryEvidence**: A bounded claim with code, source, status, context
  generation, and optional sanitized details.
- **VerificationState**: The current verification requirement and receipt-backed
  outcome for a trajectory generation.
- **ScopeCoverage**: Expected and observed scope with ratio and provenance.
- **RecoveryObservation**: A failure signature, state fingerprint, recovery action,
  route identity, outcome, and evidence grade.
- **RecoveryCapsule**: A compact cross-context handoff containing verified facts,
  attempts, non-solutions, clean point, and next action.
- **JudgeEvidence**: State-conditioned evidence slots selected for one decision.
- **SemanticEpisode**: A normalized operation-level record used for reporting and
  shadow profile evaluation.
- **ProfileCandidate**: A proposed routing or model-profile change with sample
  bounds, backtest result, gate status, and rollback reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All new evidence, verification, coverage, recovery, and capsule
  fixtures pass, and the existing repository test suite has zero regressions.
- **SC-002**: For identical fixture inputs, recovery action, evidence grade, and
  route-gate outputs are byte-for-byte deterministic across repeated runs.
- **SC-003**: 100% of fixture episodes with a mutation and no verifier receipt
  finish as `needed`, `attempted`, `failed`, or `unknown`, never `passed`
  solely from a model or summary claim.
- **SC-004**: 100% of recovery reports keep `observed`, `matched`, and
  `replayed` counts separate; no observational episode is reported as
  replay-validated.
- **SC-005**: Default telemetry tests demonstrate that secrets and raw prompt or
  tool transcript content are absent while bounded allowlisted evidence remains.
- **SC-006**: A synthetic 10x traffic test satisfies NFR-003 or records an
  explicit, measured blocker without weakening the deterministic route gate.
- **SC-007**: A candidate learned rule cannot affect active routing until shadow,
  backtest, sample-size, regression, and rollback checks all pass.
- **SC-008**: The quickstart scenarios run without paid providers and clearly
  label source/tests, offline fixtures, CI, and live runtime evidence separately.

## Assumptions

- The existing TypeScript/Node packages, decision log, controller receipts, and
  native harness extension surfaces remain the implementation base.
- Sabi schedules host inference rounds and controller handoffs; it does not own
  the host harness loop or silently switch a harness's unsupported model.
- The first implementation uses pure helpers, typed records, fixture replay, and
  shadow reports; it does not add RL, online policy promotion, or automatic live
  replay.
- The supplied arXiv synthesis and paper links are research inputs for design,
  not independently verified benchmark evidence in this feature.
- Existing config bounds such as judge state size, telemetry redaction, retry
  limits, capability catalogs, and idempotency behavior remain authoritative.
- Live provider credentials, subscription quotas, and cross-harness availability
  are environment-specific and are out of scope for local acceptance.

## Out of Scope

- Training or fine-tuning a routing model.
- Automatic policy promotion from production logs.
- Implicit replay of live user tasks or destructive commands.
- Claiming universal quality, cost, or latency improvements from offline fixtures.
- Replacing native harness loops, inventing unsupported adapter APIs, or adding a
  new provider solely to prove the feature.
