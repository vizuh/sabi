# Tasks: Trajectory IR + Adapter SDK and Conformance

**Input**: `specs/005-trajectory-ir-and-conformance/spec.md`, `plan.md`

**Prerequisites**: Spec 002 receipts + capabilities; `docs/maintainers.md`
contract; current `TrajectoryState` consumers keep working via shim.

## Phase 1: IR contracts (blocks implementation)

- [X] T001 Add `TrajectoryIR`, `DecisionEnvelope`, `AdapterManifest`, and
  `ConformanceReport` types to `packages/core/src/types.ts` (additive).
- [X] T002 Failing-first equivalence fixtures in
  `packages/core/test/ir.test.ts` (three harness shapes → same IR): 5/5 pass.

## Phase 2: IR + shim (US1)

- [X] T010 Translator `packages/core/src/ir.ts` with unknown-marking, allowlisted
  evidence refusal and conflict handling; equivalence fixtures green. Implement `packages/core/src/ir.ts` translators with
  unknown-marking and conflict handling.
- [ ] T011 Implement the `TrajectoryState` compatibility shim; regression
  tests prove current consumers unchanged.

## Phase 3: Decision envelope (US2)

- [ ] T020 Implement `packages/core/src/decision.ts` rendering, refusal
  records, and fallback-order execution.
- [ ] T021 Fixtures for untranslatable fields and fallback traversal.

## Phase 4: Manifests + conformance (US3, US4)

- [ ] T030 Manifest schema, loader, accept/refuse/downgrade logic with
  fixtures; write `adapter.json` for two existing adapters.
- [ ] T031 Implement `packages/core/src/conformance.ts` checks; fixture
  adapters (conformant/lossy/unstable/leaking) with named verdicts.
- [ ] T032 Wire `sabi adapter verify <id>` in the controller CLI with
  isolated-profile guards for live runs.

## Phase 5: Convergence

- [ ] T040 Full suite, typecheck, eval; checklist; decisions/handoff/log
  with live boundaries.

## Dependencies

- Phase 1 blocks all. Phases 2–3 parallel after Phase 1. Phase 4 needs
  Phase 2. Phase 5 last. Per-host IR migration is follow-up work, not this
  feature.
