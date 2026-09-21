# Tasks: Evidence-Aware Adaptive Scheduler

**Input**: Design documents from
`/specs/001-evidence-aware-scheduler/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`, and `quickstart.md`.

**Implementation boundary**: Build the evidence-quality and deterministic
controller foundation first. Shadow profiles and calibrated evals may be
implemented as reporting/fixture seams, but no learned candidate may change
active routing in this feature.

## Phase 1: Setup (Spec Kit artifacts)

**Purpose**: Establish the reviewed specification and repeatable validation
context. These tasks were completed before implementation began.

- [X] T001 Create the Spec Kit constitution in `.specify/memory/constitution.md` with evidence, receipt, privacy, and rollback principles.
- [X] T002 Create `specs/001-evidence-aware-scheduler/spec.md` with prioritized stories, edge cases, requirements, measurable outcomes, assumptions, and non-goals.
- [X] T003 [P] Create `specs/001-evidence-aware-scheduler/research.md`, `data-model.md`, `contracts/`, and `quickstart.md` with source boundaries and design decisions.
- [X] T004 [P] Update the managed Spec Kit context in `AGENTS.md` to point to `specs/001-evidence-aware-scheduler/plan.md`.
- [X] T005 [P] Create the requirements-quality checklist at `specs/001-evidence-aware-scheduler/checklists/requirements.md` and review it as requirements, not implementation tests.

## Phase 2: Foundational contracts (blocks implementation)

**Purpose**: Add additive types and bounded helpers that all user stories use.

- [X] T006 [P] [US1] Add `EvidenceSource`, `EvidenceStatus`, `VerificationStatus`, `ScopeCoverage`, `TrajectoryEvidence`, and `VerificationState` to `packages/core/src/types.ts`.
- [X] T007 [P] [US2] Add the allowlisted `RecoveryAction`, reason codes, and planner result types to `packages/core/src/types.ts`.
- [X] T008 [P] [US4] Add `RecoveryEvidenceGrade` and `RecoveryObservation` to `packages/core/src/types.ts` without changing existing required decision-log fields.
- [X] T009 [P] [US6] Add optional `RecoveryCapsule` to `packages/controller/src/types.ts` and preserve existing handoff/receipt fields.
- [X] T010 [P] [US7] Add `SemanticEpisode`, `ProfileCandidate`, and shadow lifecycle types to `packages/core/src/types.ts`.
- [X] T011 Add bounded serialization/redaction helpers in `packages/core/src/evidence.ts` and cover legacy optional-field parsing in `packages/core/test/evidence.test.ts`.

**Checkpoint**: Typecheck passes and every new type is additive, bounded, and
covered by at least one focused fixture before story implementation begins.

## Phase 3: User Story 1 - Preserve evidence across a trajectory (Priority: P1) 🎯 MVP

**Goal**: Make verification, provenance, and coverage explicit and sticky across
compaction/handoff generations.

**Independent Test**: `node --test packages/core/test/evidence.test.ts
packages/core/test/state.test.ts`.

- [X] T012 [P] [US1] Add failing fixtures for mutation-without-receipt, summary-claim laundering, explicit verifier receipt, and compaction generation in `packages/core/test/evidence.test.ts`.
- [X] T013 [US1] Implement monotonic evidence/provenance and verification transitions in `packages/core/src/evidence.ts`.
- [X] T014 [US1] Extend state construction in `packages/core/src/state.ts` to track verification status, context generation, and bounded scope coverage.
- [X] T015 [US1] Extend `DecisionRecord` serialization and default redaction in `packages/core/src/telemetry.ts` and `packages/core/src/log.ts` without persisting raw transcript by default.
- [X] T016 [US1] Add regression cases for old decision records and omitted optional fields in `packages/core/test/log.test.ts` and `packages/core/test/telemetry.test.ts`.

**Checkpoint**: A model or summary claim cannot produce `passed`; only current
generation evidence can do so.

## Phase 4: User Story 2 - Choose a recovery action before a model (Priority: P1) 🎯 MVP

**Goal**: Route the intervention first, then select a model/harness within the
existing capability and receipt gates.

**Independent Test**: `node --test packages/core/test/recovery-actions.test.ts
packages/core/test/recovery.test.ts`.

- [X] T017 [P] [US2] Add a fixture matrix for transport, hard failure, missing evidence, repeated failure, user denial, invalid receipt, and exhausted routes in `packages/core/test/recovery-actions.test.ts`.
- [X] T018 [US2] Implement deterministic bounded recovery action planning in `packages/core/src/recovery-actions.ts` with hard-gate precedence.
- [X] T019 [US2] Integrate action planning with `packages/core/src/recovery.ts` and `packages/core/src/router.ts` so model/tier choice follows the action.
- [X] T020 [US2] Ensure judge/learned candidates can return only code-generated valid actions in `packages/core/src/judge.ts` and `packages/core/test/judge.test.ts`.
- [X] T021 [US2] Add retries, route removal, and unknown-receipt tests that preserve host work and existing bounded idempotency in `packages/core/test/recovery.test.ts`.

**Checkpoint**: Quota/transport failures do not escalate the same unavailable
provider, and unsafe recovery becomes `unknown` or `ask-user`.

## Phase 5: User Story 3 - Give the judge minimal sufficient evidence (Priority: P1) 🎯 MVP

**Goal**: Replace last-excerpt-only judge input with bounded state-conditioned
slots while retaining deterministic bypasses.

**Independent Test**: `node --test packages/core/test/judge.test.ts`.

- [X] T022 [P] [US3] Add judge-state fixtures for intent, mutation, failure, verification, constraints, prior approach, compaction, and omitted evidence in `packages/core/test/judge.test.ts`.
- [X] T023 [US3] Implement typed `JudgeEvidence` slot selection and bounded omission handling in `packages/core/src/judge.ts`.
- [X] T024 [US3] Preserve hard failure/transport/capability gates before judge invocation in `packages/core/src/router.ts` and `packages/core/src/judge.ts`.
- [X] T025 [US3] Add server/controller bound tests for the core judge state in `packages/server/test/proxy.test.ts` and `packages/controller/test/jev.test.ts` (the controller judge boundary is `jev.ts`, not deterministic `decide.ts`).

**Checkpoint**: Unclassified rounds get sufficient bounded state; hard gates do
not pay judge cost.

## Phase 6: User Story 4 - Attribute recovery with graded evidence (Priority: P1) 🎯 MVP

**Goal**: Separate observational, matched, and replay-validated recovery.

**Independent Test**: `node --test packages/core/test/recovery.test.ts
packages/evals/test/evals.test.ts`.

- [X] T026 [P] [US4] Add observed/matched/replayed recovery fixtures with identical state fingerprints in `packages/core/test/recovery.test.ts`.
- [X] T027 [US4] Implement bounded fingerprint and evidence-grade attribution in `packages/core/src/recovery.ts`.
- [X] T028 [US4] Add an explicit side-effect-safe fixture replay seam in `packages/evals/src/backtest.ts`; live execution must never call it implicitly.
- [X] T029 [US4] Extend `packages/evals/src/tasks.ts` and `packages/evals/test/evals.test.ts` with causal-grade and unknown-receipt cases.
- [X] T030 [US4] Split recovery report aggregation by grade in `packages/server/src/report.ts` and `packages/server/test/report.test.ts`.

**Checkpoint**: No report or Wilson-style rate merges observed recovery with
replay-validated recovery.

## Phase 7: User Story 5 - Prevent false completion with verification and coverage (Priority: P2)

**Goal**: Make requested scope and verification visible in episode outcomes.

**Independent Test**: `node --test packages/core/test/evidence.test.ts
packages/evals/test/evals.test.ts`.

- [X] T031 [P] [US5] Add explicit/inferred/unknown scope fixtures and 20-requested/13-observed coverage cases in `packages/core/test/evidence.test.ts`.
- [X] T032 [US5] Add completion gating that refuses fully verified status when explicit scope or current-generation verification is missing in `packages/core/src/evidence.ts` and `packages/core/src/state.ts`.
- [X] T033 [US5] Add coverage and verification columns to normalized eval episodes in `packages/evals/src/tasks.ts` and `packages/evals/src/harness.ts`.
- [X] T034 [US5] Add PRE/LIVE/POST labels to failure detector fixtures in `packages/evals/test/evals.test.ts`.

## Phase 8: User Story 6 - Carry a compact recovery capsule across controller handoffs (Priority: P2)

**Goal**: Preserve distilled learning through `SPAWN`, `DELEGATE`, and
`ORCHESTRATE` without copying contaminated context.

**Independent Test**: `node --test packages/controller/test/controller.test.ts
packages/controller/test/agent-route.test.ts`.

- [X] T035 [P] [US6] Add capsule serialization, size, provenance, stale-generation, and incompatible-target fixtures in `packages/controller/test/controller.test.ts`.
- [X] T036 [US6] Build a bounded `RecoveryCapsule` from current controller state in `packages/controller/src/controller.ts`.
- [X] T037 [US6] Preserve capsule fields through structured handoff and target capability checks in `packages/controller/src/controller.ts` and `packages/controller/src/agents.ts`.
- [X] T038 [US6] Persist only bounded receipts/capsule metadata through `packages/controller/src/registry.ts` and cover restart/duplicate delivery in `packages/controller/test/registry.test.ts`.

## Phase 9: User Story 7 - Learn in shadow mode from semantic episodes (Priority: P2)

**Goal**: Produce local model/task evidence without changing active policy.

**Independent Test**: `node --test packages/core/test/profiler.test.ts
packages/server/test/report.test.ts`.

- [X] T039 [P] [US7] Add semantic operation, model, harness, evidence-grade, cost, latency, coverage, and verification fixtures in `packages/core/test/profiler.test.ts`.
- [X] T040 [US7] Implement bounded semantic episode aggregation in `packages/core/src/profiler.ts`.
- [X] T041 [US7] Add shadow/backtested/rejected/active/rolled-back candidate gates in `packages/core/src/profiler.ts` and `packages/core/test/profiler.test.ts`.
- [X] T042 [US7] Extend `packages/server/src/report.ts` to show local evidence counts and confidence without universal model claims.

## Phase 10: User Story 8 - Calibrate development evaluation cheaply (Priority: P3)

**Goal**: Select reproducible development subsets and keep failure information
states separate.

**Independent Test**: `npm run eval` plus `node --test
packages/evals/test/evals.test.ts`.

- [X] T043 [P] [US8] Add deterministic seeded subset and holdout fixtures in `packages/evals/test/evals.test.ts`.
- [X] T044 [US8] Implement a small calibrated subset selector in `packages/evals/src/backtest.ts` with inconclusive output when calibration is absent.
- [X] T045 [US8] Add PRE/LIVE/POST summary output and explicit offline evidence labels in `packages/evals/src/run.ts`.

## Phase 11: Polish and convergence

- [X] T046 [P] Add a synthetic 10x deterministic-path benchmark and bounded-memory assertion in `packages/core/test/performance.test.ts`.
- [X] T047 [P] Add consistency analysis findings and resolve any uncovered requirements in `specs/001-evidence-aware-scheduler/checklists/requirements.md`.
- [X] T048 Update `docs/decisions.md`, `docs/handoff.md`, `docs/research/backlog-implemented.md`, and `log.md` with implemented scope and explicit unverified/live boundaries.
- [X] T049 Run `npm test`, `npm run typecheck`, `npm run eval`, `git diff --check`, and the quickstart commands; record results without claiming deployment or live provider performance.

## Dependencies and execution order

## Requirement traceability

| Requirement | Covered by |
|---|---|
| FR-001–FR-003 | T006, T011, T013-T016, T031-T034 |
| FR-004–FR-005 | T007, T017-T021, T024 |
| FR-006 | T022-T025 |
| FR-007–FR-008 | T008, T026-T030 |
| FR-009 | T009, T035-T038 |
| FR-010–FR-011 | T010, T039-T042 |
| FR-012 | T029, T034, T043-T045 |
| FR-013–FR-015 | T011, T015-T016, T019-T025, T037-T038 |
| NFR-001–NFR-002 | T011, T018, T023, T027, T036, T040 |
| NFR-003 | T046 |
| NFR-004 | T017, T022, T026, T043, T049 |
| SC-001–SC-002 | T012, T017, T022, T026, T031, T035, T039, T043, T049 |
| SC-003–SC-005 | T013-T016, T026-T034, T038, T042 |
| SC-006 | T046, T049 |
| SC-007–SC-008 | T041, T044-T045, T048-T049 |

### Phase dependencies

- Phase 1 is complete and provides the specification context.
- Phase 2 blocks all code stories because shared types and bounds must exist first.
- Phases 3-6 are the MVP and run sequentially where they touch shared core files.
- Phase 7 depends on Phase 3; Phase 8 depends on Phases 4 and 6.
- Phase 9 depends on Phases 3-6; Phase 10 depends on the episode contract.
- Phase 11 depends on every desired implementation phase.

### Agent lanes

- **Lane A — core evidence/recovery**: T006-T034; one writer, sequential shared
  files, read-only reviewer after each MVP gate.
- **Lane B — controller continuity**: T009, T035-T038; starts after core
  contracts and uses an isolated worktree or exact path.
- **Lane C — profiler/evals/report**: T010, T028-T034, T039-T045; starts after
  the episode/evidence contracts and never changes active routing.
- **Coordinator/reviewer**: T046-T049; validates cross-lane integration,
  checklist coverage, and evidence boundaries.

### Parallel opportunities

- T006-T010 are parallel because they add non-overlapping type groups.
- T012, T017, T022, T026, T031, T035, T039, and T043 are parallel test-first
  preparation only when their files do not overlap in the active worktree.
- Lane B and Lane C can run in isolated worktrees after Phase 2; merge/reconcile
  is serialized by the coordinator.

## Implementation strategy

1. Keep the existing deterministic router as the active fallback.
2. Ship the P1 evidence/recovery slice first and validate it independently.
3. Add controller capsules and semantic reporting only after the P1 contracts
   pass.
4. Keep learned candidates in shadow/backtest and make rollback explicit.
5. Stop if a test, compatibility gate, or evidence boundary fails; do not
   weaken the requirement to make a task green.

## Notes

- Every task has an ID, optional `[P]` marker, story label where applicable,
  and exact file paths.
- The tasks are implementation-oriented; research claims remain bounded by
  `research.md` and never replace source or runtime evidence.
