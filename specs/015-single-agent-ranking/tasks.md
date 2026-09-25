# Tasks: Single Agent Ranking

**Input**: `specs/015-single-agent-ranking/spec.md`, `plan.md`
**Prerequisites**: none. Independent of 014.

## Phase 1: Characterize current behaviour (before any change)

- [ ] **T001** Enumerate every call site that currently reaches
  `bestSession` / `bestHarness` / the controller-local ranking in
  `controller.ts`. Record them. These are the sites that will change.
- [ ] **T002** Write characterization tests for representative inventories:
  healthy single session, several sessions with differing capacity, a
  rate-limited session with a short reset, a quota-exhausted session, and a
  free-catalog case. Each asserts the currently selected agent.
- [ ] **T003** Run them against unmodified code and record the output. They MUST
  pass now. This is the baseline the post-change run is compared against.
- [ ] **T004** Identify which characterization cases pass only because the
  duplicate lacks a gate. Mark them; they are expected to change and the change
  must be explained rather than accepted silently.

## Phase 2: Prove the defect

- [ ] **T010** Write a failing test: a harness that fails
  `requiredCapabilities` but has high capacity is selected by a controller path
  today. Run it and record that it fails for the expected reason.
- [ ] **T011** Assert the same inventory through `planAgentRoute` and confirm the
  planner rejects the harness, while the controller's own ranking accepts it.
  That divergence IS the bug, demonstrated rather than asserted.
- [ ] **T012** Commit the failing test before the fix, so the fix is provable.

## Phase 3: Consolidate

- [ ] **T020** Delete `capacityRank`, `preferenceRank`, `freeCatalogScore`,
  `bestSession` and `bestHarness` from `controller.ts`.
- [ ] **T021** Import the ranking from `agents.ts` at each of the Phase 1 call
  sites. No reimplementation, no aliasing.
- [ ] **T022** Move eligibility INTO the shared ranking entry point so a future
  call site cannot omit the gate. This is the structural half of the fix.
- [ ] **T023** Replace `planAgentRoute`'s fallback branch so it does not bypass
  the same gate it computed.
- [ ] **T024** Run the Phase 2 failing test. It MUST now pass.
- [ ] **T025** Run the Phase 1 characterization tests. Every case marked in T004
  MUST be explained; every unmarked case MUST still pass unchanged.
- [ ] **T026** Run the full controller suite. Any difference is investigated as
  a finding, not updated away.

## Phase 4: Purity as a test

- [ ] **T030** Add an import-boundary test asserting `agents.ts` imports no
  harness, Orca transport, or Jev client module. This converts its docstring
  claim into a constraint.
- [ ] **T031** Add a test asserting ranking functions are declared in exactly
  one module, so a second copy cannot reappear unnoticed.
- [ ] **T032** Assert the Jev boundary is intact: Jev still selects only from
  the pre-validated action set, and `agents.ts` remains uninvolved.

## Dependencies

- Phase 1 blocks 3. T003's recorded baseline is the only evidence that Phase 3
  preserved eligible behaviour.
- Phase 2 blocks 3. T012's failing test is the only evidence the fix changed
  something.
- Phase 4 is independent and may land with 3.

## Explicit non-goals

- Redesigning the ranking order. If the current ordering is wrong, that is a
  separate decision with its own evidence. This removes the duplicate and stops
  ineligible candidates being selected; it does not change who is best among
  eligible candidates.
- Harness identity and dispatch. That is 014.
- The absence of a non-Orca execution path. Separate and larger.
- Any change to Jev's role in choosing between pre-validated actions.
