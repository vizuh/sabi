# Tasks: Continuity, Reliability Plane, Durable State

**Input**: `specs/006-continuity-reliability-durability/spec.md`, `plan.md`

**Prerequisites**: Spec 002 receipts; `cache-routing.ts` economics;
controller registry; `node:sqlite` availability.

## Phase 1: Contracts (blocks implementation)

- [ ] T001 Add `ContinuityState`, `FailureClass`, `HealthRecord` types
  (additive) plus fixture matrices for affinity, taxonomy, breaker
  transitions.

## Phase 2: Continuity (US1)

- [ ] T010 Implement `packages/core/src/continuity.ts`: can-switch before
  should-switch, release boundaries, preferred-affinity cache economics.
- [ ] T011 Wire into routing so required affinity pins with receipted
  reasons; cache-routing tests unregressed.

## Phase 3: Classification (US2)

- [ ] T020 Implement `packages/core/src/failure-class.ts` eight-way
  classifier + intervention-family map.
- [ ] T021 Wire into recovery planning (transport→retry/backoff,
  entitlement→route-removal, refusal→surface, reasoning→existing path).

## Phase 4: Reliability (US3)

- [ ] T030 Implement `packages/core/src/reliability.ts`: health ledgers,
  breakers with half-open probes, cooldowns, backoff+jitter, retry budgets,
  concurrency/rate windows.
- [ ] T031 Propagate deadlines/cancellation through dispatch; chaos
  fixtures (outage/flap/slow-death/saturation) with measured fast-fail.
- [ ] T032 Provider-before-model fallback order fixtures.

## Phase 5: Durable state (US4)

- [ ] T040 Implement `packages/controller/src/store.ts` (SQLite/WAL,
  0600 files, versioned migrations, bounded retention, JSONL export).
- [ ] T041 Crash/duplicate/late-receipt/two-writer fixtures; registry
  becomes a store facade with caller-compatible API.

## Phase 6: Convergence

- [ ] T050 Full suite, typecheck, eval; checklist; decisions/handoff/log
  with live boundaries.

## Dependencies

- Phase 1 blocks all. Phases 2–3 sequential (planner adjacency). Phase 4
  needs Phase 3 classes. Phase 5 needs registry contracts only — parallel
  with 2–4 in an isolated worktree. Phase 6 last.
