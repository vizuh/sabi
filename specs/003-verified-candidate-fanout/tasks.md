# Tasks: Verified Candidate Fanout

**Input**: `specs/003-verified-candidate-fanout/spec.md`, `plan.md`

**Prerequisites**: Spec 002 receipts + capabilities + isolation (Phases 1–2
minimum); 001 shadow gates; surplus resource rules.

## Phase 1: Planning contracts (blocks implementation)

- [ ] T001 Add `FanoutPlan`, `CandidateReceipt`, `ArbitrationOutcome`,
  `FanoutEpisode`, and `candidate-fanout` action to core types (additive).
- [ ] T002 Failing-first fixtures in `packages/core/test/fanout.test.ts`:
  bounds, missing isolation/verifier, destructive shapes, out-of-scope writes.

## Phase 2: Planner + safety screen (US1 partial, US2)

- [ ] T010 Implement `packages/core/src/fanout.ts` planning with branch,
  model, attempt, time, and scope bounds plus explicit refusal reasons.
- [ ] T011 Implement the safety screen (destructive shapes, scope
  containment) ahead of any execution seam.
- [ ] T012 Wire `candidate-fanout` preconditions into recovery planning with
  single-candidate fallback preserved.

## Phase 3: Arbitrator (US1)

- [ ] T020 Implement receipt arbitration: winner requires `passed` receipt;
  losers retained; duplicates deduped by fingerprint.
- [ ] T021 Total-failure path yields receipt-backed escalation, never silent
  selection; stale-candidate handling.
- [ ] T022 Flaky-verifier disagreement becomes `unknown` with a recorded
  reason.

## Phase 4: Controller runner (US1 execution)

- [ ] T030 Implement `packages/controller/src/fanout.ts` branch execution
  against fixture workspace/verifier doubles; budget kills receipted.
- [ ] T031 Persist branch receipts in the registry by branch id; idempotent
  re-delivery.

## Phase 5: Surplus workers (US3)

- [ ] T040 Replayable-operation classifier; worker-mode assignment with
  verifier arbitration in `packages/controller/src/surplus.ts`.
- [ ] T041 Ledger separation of worker-mode vs review-mode; review-only
  boundaries unchanged for non-replayable ops.

## Phase 6: Shadow policy + convergence (US4)

- [ ] T050 Fanout episode aggregation and candidate-rule gates via the 001
  profiler path; rollback to deterministic behavior covered.
- [ ] T051 Full suite, typecheck, eval; checklist; decisions/handoff/log with
  live boundaries (no live-provider or quality claims from fixtures).

## Dependencies

- Phase 1 blocks all. Phases 2–3 sequential (shared new file, one writer).
  Phase 4 needs 2–3. Phase 5 needs 002 receipts + surplus rules. Phase 6 last.
