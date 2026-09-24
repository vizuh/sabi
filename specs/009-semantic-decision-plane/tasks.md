# Tasks: Semantic Decision Plane

**Input**: `specs/009-semantic-decision-plane/spec.md`, `plan.md`

**Prerequisites**: Current `judge.ts` + `JudgeEvidence`; 001 shadow gates;
spec 002 receipts (frame inputs); JEVfire semantics understood as
relative-only local scores.

## Phase 1: Frame contracts (blocks implementation)

- [ ] T001 Add `DecisionFrame`, `SemanticBackend`, `QuestionDef`,
  `ShadowJudgment` types (additive) + dependency-cycle fixtures.

## Phase 2: Frame (US1)

- [ ] T010 Implement `packages/core/src/decision-frame.ts`: single
  assembly, generation-keyed cache, independent-batch vs staged
  dependents, gate precedence with fact-sourced marking.
- [ ] T011 Equivalence fixtures vs sequential calls; invalidation tests.

## Phase 3: Backends (US2)

- [ ] T020 Implement `packages/core/src/semantic-backends.ts`: lane
  interface, Jev lane (existing client), structured-LLM fallback,
  fixture local lane; cheapest-eligible routing; privacy refusal;
  calibration labeling; fail-open outages.

## Phase 4: Questions (US3)

- [ ] T030 `packages/core/src/questions/` registry with versioned assets,
  independence validation, promotion minimums, v-next backtest harness.
- [ ] T031 Migrate the three current Jev questions as v1 assets without
  behavior change (proven by existing judge tests).

## Phase 5: Shadows + inspector (US4, US5)

- [ ] T040 Shadow judgment collection with on/off routing-equivalence
  fixtures and outage-gap recording.
- [ ] T041 `scripts/inspect-adapter.ts` + CLI wiring: planted-pattern
  fixtures for mappings and rejects.

## Phase 6: Convergence

- [ ] T050 Full suite, typecheck, eval; checklist; decisions/handoff/log
  with live boundaries (no calibrated claims for local-lane scores).

## Dependencies

- Phase 1 blocks all. Phases 2–3 sequential (frame then lanes). Phase 4
  needs Phase 2. Phase 5 needs 2–4. Phase 6 last. Real local backend
  packaging is a follow-up, not this feature.
