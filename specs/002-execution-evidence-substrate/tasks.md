# Tasks: Execution Evidence Substrate

**Input**: `specs/002-execution-evidence-substrate/spec.md`, `plan.md`

**Prerequisites**: 001 implemented (done); `docs/specs/decision-signals.md`,
`command-code-evidence-parity`, vnext requirements 1–3.

## Phase 1: Contracts (blocks implementation)

- [X] T001 Add `ExecutionReceipt`, `ExecutionCapabilities`, capability
  tri-state, and extended `RecoveryAction` to `packages/core/src/types.ts`
  (additive only).
- [X] T002 Fixture expectations in `packages/core/test/receipts.test.ts`
  (written failing-first) plus `packages/core/src/receipts.ts` builders,
  fingerprints, sanitizers to green: 14 tests pass.
- [X] T003 Capability declaration/gating fixtures in
  `packages/core/test/capabilities.test.ts` (written failing-first) plus
  `packages/core/src/capabilities.ts` unknown-default gating to green:
  7 tests pass.

**Checkpoint**: Typecheck passes; new types additive and bounded.

## Phase 2: Receipt primitive (US1)

- [X] T010 Implement builders in `packages/core/src/receipts.ts`: sources
  test/build/lint/edit/git/repo-map/sandbox; scope-mismatch flag; unknown
  defaults; `operationId` idempotency.
- [X] T011 Wire receipt-backed transitions into `packages/core/src/evidence.ts`;
  extend `packages/core/test/evidence.test.ts` (wrong-target verifier,
  contradictory output, out-of-order arrival).
- [X] T012 Persist receipts by `operationId` in
  `packages/controller/src/registry.ts`; restart/duplicate-delivery tests.

## Phase 3: Capabilities (US2)

- [X] T020 Implement `packages/core/src/capabilities.ts` with
  unknown-defaults and gating helpers; capability snapshot pinned at plan time.
- [X] T021 Wire gating into `packages/core/src/recovery-actions.ts` and
  router so receipt-dependent actions require declared capabilities.
- [X] T022 Fixture harnesses (full/partial/none) proving degradation is
  explicit, never silent.

## Phase 4: New actions (US3)

- [X] T030 Extend the 001 fixture matrix: verify-before-repair,
  rollback-with-clean-point, switch-on-transport-with-alternate.
- [X] T031 Implement precedence in `packages/core/src/recovery-actions.ts`;
  escalation-precision fixtures must not regress.
- [X] T032 Extend `RecoveryCapsule` clean-point linkage for rollback bounds.

## Phase 5: Adapter parity (US4)

- [ ] T040 One emitter mapping per adapter path (mod, proxy, plugin, bundle);
  shared join test over core fields with redaction assertions.
- [ ] T041 Explicit-unknown coverage for session/usage/price/latency gaps.

## Phase 6: Convergence

- [ ] T050 Full `npm test`, typecheck, eval; requirements checklist;
  `docs/decisions.md`, handoff, log entries with live boundaries.
- [ ] T051 Record 003-ready proof: a verifier receipt produced in one harness
  is consumable by planner fixtures in another (schema-level, no live run).

## Dependencies

- Phase 1 blocks all code phases. Phases 2–3 parallel after Phase 1 (different
  files). Phase 4 needs 2+3. Phase 5 needs Phase 2. Phase 6 last.
- Spec 003 (fanout) starts after Phase 2; spec 004 (report surfaces) after
  Phase 5.
