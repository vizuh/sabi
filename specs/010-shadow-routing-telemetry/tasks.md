# Tasks: Shadow Routing and Operational Telemetry

**Input**: `specs/010-shadow-routing-telemetry/spec.md`, `plan.md`

**Prerequisites**: 001 shadow-gate concepts; decision/telemetry records;
006 store conventions (use when present, mirror them until then).

## Phase 1: Mirror contracts (blocks implementation)

- [X] T001 Add `ShadowRecord`, `RetentionPolicy`, `MetricSeries` types
  (additive) + on/off equivalence fixture skeletons.

## Phase 2: Mirror (US1)

- [X] T010 Implement `packages/core/src/shadow.ts` writer with
  byte-equivalence guard fixtures (routing identical on/off).
- [X] T011 Divergence flags (actual vs proposed with reasons); candidate
  set capture.

## Phase 3: Bounds (US1 continued)

- [X] T020 Retention with export-first compaction; gap/drop accounting.
- [ ] T021 Write-time sanitizer with quarantine + reasons; routing
  unaffected fixtures.

## Phase 4: Metrics (US2)

- [X] T030 Implement `packages/core/src/metrics.ts` operational series
  (latencies, TTFT, retries, provider state, switches, locks, errors).
- [X] T031 Bounded labels, redaction fixtures, outage-series fixtures.

## Phase 5: Corpus (US3)

- [X] T040 Slicing by class/model/harness/divergence with counts +
  provenance; report views.
- [ ] T041 CLI `sabi shadow on/off` + status.

## Phase 6: Convergence

- [ ] T050 Full suite, typecheck, eval; checklist; decisions/handoff/log
  (mirrors labeled, never benchmarks).

## Dependencies

- Phase 1 blocks all. Phases 2–3 sequential (writer then bounds).
  Phases 4–5 parallel after Phase 1. Phase 6 last.
