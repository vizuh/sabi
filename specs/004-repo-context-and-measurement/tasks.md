# Tasks: Repo Context Providers and Measurement

**Input**: `specs/004-repo-context-and-measurement/spec.md`, `plan.md`

**Prerequisites**: Spec 002 receipts (chain views need them); 001 report/
telemetry bounds; `docs/estimates.md` discipline.

## Phase 1: Provider contracts (blocks caching)

- [ ] T001 Add `RepoContextProvider`, freshness/invalidation, and task-metric
  types to `packages/core/src/types.ts` (additive).
- [ ] T002 Failing-first fixtures in `packages/core/test/repo-context.test.ts`:
  reuse, fingerprint-change invalidation, absent-provider parity.

## Phase 2: Caching (US1)

- [ ] T010 Implement `packages/core/src/repo-context.ts`; wire router reuse
  with explicit reuse/invalidation records.
- [ ] T011 Tool-observed-files win over provider maps on disagreement, with
  mismatch flags.

## Phase 3: Chain views (US2)

- [ ] T020 Extend `packages/server/src/report.ts` with receipt-chain views
  for escalations, fanout outcomes, verifications; grade markers for
  unverified claims.
- [ ] T021 Fixture report tests covering linked receipts and empty states.

## Phase 4: Metric catalog (US3)

- [ ] T030 Implement `packages/core/src/metrics.ts`: per-completed-task
  dimensions, provenance labels, sample bounds, unknown-handling.
- [ ] T031 Composition rule: local savings always rendered with end-to-end
  task context; fixture labels mandatory.
- [ ] T032 Metric export redaction tests (identifiers stripped).

## Phase 5: Transport spike (US4, P3)

- [ ] T040 Time-boxed profile of hook→daemon→decision latency; write
  `docs/research/uds-spike.md` with the threshold verdict and numbers.
- [ ] T041 Only on above-threshold verdict: Unix-only opt-in UDS with HTTP
  fallback and identical auth; otherwise close with the recorded decision.

## Phase 6: Convergence

- [ ] T050 Full suite, typecheck, eval; checklist; decisions/handoff/log with
  live boundaries (no universal claims from fixtures).

## Dependencies

- Phase 1 blocks 2–4. Phases 2–4 parallel after Phase 1 (separate files).
  Phase 5 independent of 2–4 (instrumentation only). Phase 6 last.
