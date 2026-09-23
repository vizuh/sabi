# Feature Specification: Execution Evidence Substrate

**Feature Branch**: `002-execution-evidence-substrate`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Simplicio-material synthesis (deterministic local execution evidence as
first-class routing input) mapped against `001-evidence-aware-scheduler` (all 49 tasks
implemented) and `docs/specs/adaptive-inference-scheduler-vnext.md`.

## Context: what already exists

- 001 gives Sabi `TrajectoryEvidence`, `VerificationState` (with `receiptId`),
  graded `RecoveryObservation`, `RecoveryCapsule`, and action-before-model planning
  over `continue | retry-same | retry-with-feedback | gather-evidence |
  escalate-model | fresh-context | rollback-with-reflection | ask-user`.
- `ControllerExecutionReceipt` (`packages/controller/src/types.ts`) is minimal:
  phase + observedAt + requestId. It records controller dispatches, not
  test/build/lint/edit verdicts.
- `docs/specs/decision-signals.md` defines deterministic signal producers with
  store bounds and lineage; `command-code-evidence-parity` delivered the first
  adapter receipt slice; vnext phases 1–3 describe the receipt → intervention →
  candidate pipeline this feature implements.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record rich execution receipts (Priority: P1)

As a routing decision, I need test, build, lint, edit, git, repo-map, and sandbox
outcomes as typed receipts — with source, status, duration, fingerprints, changed
files, verifier identity, exit code, scope counts, and isolation metadata — so that
a verifier verdict outweighs any model self-report.

**Why this priority**: Every fanout, verification, and learning decision in 003/004
consumes receipts. Without a shared primitive each consumer invents its own shape.

**Independent Test**: Feed tool results, verifier exits, and edit events through
receipt builders; assert bounded sanitized records, stable fingerprints for
identical inputs, and `unknown` (never fabricated) for missing fields.

**Acceptance Scenarios**:

1. **Given** a test run that exits 0 with a machine-readable summary, **when** the
   receipt is built, **then** status is `passed` with verifier name, exit code,
   duration, and observed scope counts.
2. **Given** a verifier that exits 0 but checks the wrong target, **when** scope
   comparison runs, **then** the receipt keeps `passed` for the run but records a
   scope mismatch flag, and completion stays unverified.
3. **Given** a model message claiming "tests passed" with no receipt, **when**
   verification is assessed, **then** status remains `needed`/`unknown` per 001
   FR-001 — unchanged behavior, now with a receipt-shaped hole the router can see.

---

### User Story 2 - Discover what each harness can prove (Priority: P1)

As Sabi running host-agnostic, I need a per-harness `ExecutionCapabilities`
contract (repo map, incremental context, deterministic edit, isolated
workspaces, verifier receipts, event-driven changes) so routing adapts to what
exists instead of assuming it.

**Why this priority**: It preserves the README's host-agnostic philosophy while
letting a Simplicio-class runtime, Claude Code, Codex, or Oh My Pi each contribute
different evidence. Sabi consumes capabilities; it never owns the runtime.

**Independent Test**: Declare capability sets for three fixture harnesses (full,
partial, none); assert the planner only selects receipt-dependent actions where
the capability is declared, and degrades explicitly elsewhere.

**Acceptance Scenarios**:

1. **Given** a harness declaring `verifierReceipts: false`, **when** recovery is
   planned, **then** `verify-local` is never selected and the reason is recorded.
2. **Given** a harness declaring `isolatedWorkspaces: true`, **when** a risky
   candidate is considered, **then** isolation becomes a precondition the 003
   fanout can rely on.
3. **Given** an unknown harness, **when** capabilities are read, **then** every
   flag is `unknown` (never assumed true) and routing falls back to 001 behavior.

---

### User Story 3 - Verify and roll back before escalating (Priority: P1)

As a user with a failing trajectory, I need `verify-local`, `rollback`, and
`switch-harness` in the recovery vocabulary so Sabi tries deterministic
interventions before spending a stronger model.

**Why this priority**: This is the action-before-model maturation: escalation is
the last resort, not the default response to failure evidence.

**Independent Test**: Extend the 001 fixture matrix with receipt-backed failures;
assert `verify-local` wins when a verifier exists and the mutation is
unverified, `rollback` wins on repeated failure with a clean point, and
`escalate-model` remains for evidence that survives verification.

**Acceptance Scenarios**:

1. **Given** a failed edit with no verifier run yet, **when** recovery is
   planned, **then** the action is `verify-local`, not `escalate-model`.
2. **Given** two consecutive failed repairs and a capsule clean point, **when**
   recovery is planned, **then** the action is `rollback`, bounded to the clean
   point with reflection notes.
3. **Given** a transport/quota failure on the current harness, **when** an
   alternate capable harness is registered, **then** `switch-harness` is eligible;
   otherwise the 001 retry/route-removal behavior is unchanged.

---

### User Story 4 - Every adapter emits one normalized receipt (Priority: P2)

As a maintainer joining receipts across hosts, I need Command Code, OpenCode,
Hermes, Oh My Pi, Prime Agent, Orca, and DSH emission paths to produce the same
core receipt shape with explicit unknowns, so reports and fanout arbiters never
branch on host-specific fields.

**Why this priority**: vnext requirement 1; without it every consumer re-implements
host sniffing.

**Independent Test**: Emit receipts from each adapter's fixture path; assert a
single join over core fields succeeds with no raw prompts, arguments, or secrets.

**Acceptance Scenarios**:

1. **Given** a proxy round and a mod round for the same operation class, **when**
   both receipts are stored, **then** they share field names, units, and
   unknown-markers.
2. **Given** a missing session, usage, price, or latency value, **when** the
   receipt is built, **then** the field is an explicit unknown, never zero or
   an invented default.

### Edge Cases

- A verifier emits contradictory output (exit 0, summary says failures).
- Receipts arrive out of order across two processes or harnesses.
- A receipt references files outside the trajectory scope.
- The process restarts between an execution request and its receipt; duplicate
  delivery must be idempotent via `operationId`.
- A capability changes mid-session (harness upgrade); in-flight plans keep the
  declared-at-plan-time snapshot.
- Fingerprint collision across different inputs; collision degrades to `unknown`
  linkage, never false attribution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST define a shared `ExecutionReceipt` with operationId,
  source, status, timestamps/duration, input/output fingerprints, changed files,
  verifier, exit code, scope counts, and isolation metadata — all bounded and
  sanitized.
- **FR-002**: Receipt status MUST be `passed | failed | unknown`; `passed`
  requires a verifier signal, never a model claim alone.
- **FR-003**: Sabi MUST define `ExecutionCapabilities` (repoMap,
  incrementalContext, deterministicEdit, isolatedWorkspaces, verifierReceipts,
  eventDrivenChanges) with `true | false | unknown` semantics; `unknown` MUST
  NOT enable receipt-dependent actions.
- **FR-004**: The recovery vocabulary MUST add `verify-local`, `rollback`, and
  `switch-harness` with deterministic precedence: verify before repair,
  rollback on repeated failure with a clean point, switch on transport failure
  with a capable alternate, escalate only for verification-surviving evidence.
- **FR-005**: Every supported adapter emission path MUST produce the core
  receipt shape with explicit unknowns; no raw prompts, tool arguments, paths
  beyond changed-file names, or secrets.
- **FR-006**: Receipts MUST be idempotent on `operationId` across restarts and
  duplicate delivery.
- **FR-007**: Existing 001 records MUST remain readable; new fields are
  additive and optional.

### Non-Functional Requirements

- **NFR-001**: Receipt building and capability gating MUST be deterministic for
  identical inputs.
- **NFR-002**: Receipt payloads MUST respect existing judge/handoff character
  bounds; no unbounded diff or log retention.
- **NFR-003**: No test or fixture may require paid inference, live credentials,
  or a live harness runtime.
- **NFR-004**: The deterministic routing path keeps the 001 NFR-003 overhead
  budget (≤10% median at 10x synthetic traffic).

### Key Entities

- **ExecutionReceipt**: cross-cutting deterministic outcome record (see FR-001).
- **ExecutionCapabilities**: per-harness declared evidence surface (see FR-003).
- **Extended RecoveryAction**: 001 vocabulary plus `verify-local`, `rollback`,
  `switch-harness`.
- **AdapterReceiptEmitter**: per-adapter mapping from host events to the core
  receipt shape.

## Success Criteria *(mandatory)*

- **SC-001**: Fixture matrix passes for receipt building, capability gating,
  and the three new actions; zero regressions in the existing suite.
- **SC-002**: 100% of receipt-dependent actions in fixtures are gated on a
  declared capability; none fire on `unknown`.
- **SC-003**: Joined receipts from all adapter fixture paths share one schema
  with zero raw-prompt/secret leaks under redaction tests.
- **SC-004**: Failure fixtures that previously escalated now verify or roll
  back first where receipts/clean points exist; escalation precision on
  fixtures does not regress.

## Assumptions

- 001 types and helpers are the implementation base; this feature extends them.
- Harnesses declare capabilities cooperatively; Sabi never probes beyond the
  supported extension surface.
- Verifiers are host-side; Sabi standardizes their output, it does not implement
  test runners.

## Out of Scope

- Candidate fanout and speculative execution (spec 003).
- Repo indexing or map ownership (spec 004 consumes, never owns).
- Transport changes such as Unix-socket IPC (spec 004 spike, profile-gated).
- Learned promotion from receipts (001 shadow gates remain authoritative).
