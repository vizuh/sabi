# Tasks: ACP and A2A Bridges

**Input**: `specs/007-acp-a2a-bridges/spec.md`, `plan.md`

**Prerequisites**: Controller handoff/capsule path; spec 002 receipts;
spec 005 IR/Decision (bridge I/O shapes); live wire details verified at
build time with cited repo/commit/date.

## Phase 1: Protocol verification (blocks implementation)

- [ ] T001 Record verified ACP + A2A wire references (repo, commit, date)
  in `docs/research/`; flag any drift from previously read docs.

## Phase 2: ACP bridge (US1, US2)

- [ ] T010 Fixture ACP peer + round-trip tests (lifecycle, negotiate,
  resume, cancel, progress).
- [ ] T011 Implement bridge with deny-default permissions and
  receipted partial work on cancel.
- [ ] T012 Inference-refusal matrix for ACP-only hosts + claim
  assertions (inference never listed).

## Phase 3: A2A bridge (US3)

- [ ] T020 Fixture agents with capability cards; discovery filter tests.
- [ ] T021 Implement delegation with capsules, typed artifacts, streaming,
  idempotent async reconcile (006 store semantics).
- [ ] T022 Card-as-declaration handling; unverified claims never route.

## Phase 4: Receipts + convergence

- [ ] T030 002 receipts on both bridges; shared-report join test.
- [ ] T031 Adapter manifests (`adapter.json`) for both bridges.
- [ ] T032 Full suite, typecheck; checklist; decisions/handoff/log with
  evidence-layered claims (no live certification implied).

## Dependencies

- Phase 1 blocks all. Phases 2–3 parallel after Phase 1 (separate
  packages). Phase 4 last.
