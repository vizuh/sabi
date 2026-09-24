# Tasks: Native Protocols, Capability Evidence, Route Objectives

**Input**: `specs/008-protocols-objectives-evidence/spec.md`, `plan.md`

**Prerequisites**: Borrowed-auth passthrough pattern; `ModelCapabilities`;
spec 002 receipts; spec 005 preservation checks; live protocol references
verified at build time.

## Phase 1: Protocol verification (blocks implementation)

- [ ] T001 Record Gemini (+ existing three) wire references (repo/commit/
  date) in `docs/research/`; note any drift.

## Phase 2: Wire + Gemini (US1, US2)

- [ ] T010 Fixture generateContent shapes (stream/tools/parallel/structured).
- [ ] T011 Implement native handler with passthrough of unknown fields.
- [ ] T012 Diff-scoped mutation with field-level mutation receipts; no
  silent rewrites.

## Phase 3: Evidence registry (US3)

- [ ] T020 Implement `packages/core/src/capability-evidence.ts`:
  promotion, TTL expiry, precedence (receipt > probe > catalog > config).
- [ ] T021 Harness-leg vs model-leg attribution fixtures.
- [ ] T022 Wire highest-non-expired level into candidate filtering with
  recorded levels.

## Phase 4: Objectives (US4)

- [ ] T030 Implement `packages/core/src/objectives.ts` compiler +
  eligibility verdicts (caps, locality, privacy, evidence floor).
- [ ] T031 Unknown-cost exclusion + unsatisfiable refusal-with-reason
  fixtures.
- [ ] T032 Tier selection unchanged proved by existing tier tests.

## Phase 5: Convergence

- [ ] T040 Full suite, typecheck, eval; checklist; decisions/handoff/log
  with live boundaries (no live-provider claims).

## Dependencies

- Phase 1 blocks all. Phases 2–4 parallel after Phase 1 (separate files).
  Phase 5 last.
