# Feature Specification: Single Agent Ranking

**Feature Branch**: `015-single-agent-ranking`

**Created**: 2026-09-25

**Status**: Planned

**Input**: Architecture audit finding — the controller's agent-ranking logic
exists twice, near-verbatim, and the two copies disagree. This is a correctness
bug, not a tidiness issue, and is scoped separately from 014 because it changes
behaviour and carries different risk.

## Context: what already exists

`packages/controller/src/agents.ts` is the documented pure planner. Its own
docstring at line 164 states:

> `/** Pure capacity gate and handoff planner. It never calls a harness or invokes Jev. */`

It defines `capacityRank` (~108), `preferenceRank` (~123), `freeCatalogScore`
(~139) and `best` (~143-162), and exports `planAgentRoute` (~165-221), which
applies them after `eligibility` (~44-106) has gated out ineligible candidates.

`packages/controller/src/controller.ts` then re-declares the same four
functions plus `bestSession` (~239) and `bestHarness` (~245) over the same
ranking keys: capacity → preference → free-catalog → `lastOutputAt` → id. Both
read the same exported `catalogFreeWorkerCount`.

## The confirmed defect

`planAgentRoute` filters by `requiredCapabilities` and applies quota and
rate-limit wait arithmetic that `bestSession`/`bestHarness` do not apply.

**Consequence: a harness that `agents.ts` deems ineligible can still be chosen
by `controller.ts`, and can therefore be spawned.** The two copies answer "who
is the best available agent" differently, and the controller consults both —
`planAgentRoute`'s result for its action and as the fallback branch, its own
`bestSession`/`bestHarness` at the independent call sites. Which one wins
depends on the branch taken.

This is the sharpest coupling risk found in the audit: changing a selection rule
requires edits in two files to stay consistent, and nothing fails if one is
missed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One ranking decides (Priority: P1)

As a maintainer changing how the best agent is chosen, I need to change it in
one place, so that the planner and the controller cannot disagree.

#### Acceptance Criteria

1. **One implementation.** The ranking functions MUST be defined once. The
   duplicate declarations in `controller.ts` MUST be deleted, and the
   controller MUST import from `agents.ts`.
2. **The planner's gating is the only gate.** Eligibility — required
   capabilities, quota wait arithmetic, rate-limit wait arithmetic — MUST be
   applied to every candidate before ranking, for every call site. A candidate
   the planner rejects MUST NOT be selectable anywhere.
3. **Call sites agree.** Every site that previously called `bestSession` or
   `bestHarness` MUST observe the same eligibility gate.
4. **Behaviour is preserved where it was already correct.** For candidates that
   pass eligibility, the chosen agent MUST be unchanged from today. This is a
   bug fix, not a re-ranking.

#### Testing

- A characterization test, written before the change, that asserts the current
  selection for a representative inventory. It must pass before and after.
- A test constructing a harness that fails `requiredCapabilities` and asserting
  it is never selected, on every call path that previously could select it.
- A test asserting no ranking function is declared in more than one module.

### User Story 2 — The disagreement is provable before it is fixed
(Priority: P1)

As a reviewer, I need a failing test that demonstrates the bug, so that the fix
is known to have changed something.

#### Acceptance Criteria

1. **A failing test exists first.** A test MUST demonstrate that a
   capability-ineligible but high-capacity harness is selected by a controller
   path today. It is committed failing, or its pre-fix form is recorded.
2. **The fix turns it green.** After consolidation the same test passes, and it
   asserts the planner's decision, not an implementation detail.
3. **The test is behavioural.** It asserts which agent is chosen, not which
   function was called.

#### Testing

- The regression test itself, named for the behaviour it protects.

### User Story 3 — The planner stays pure (Priority: P1)

As the owner of `agents.ts`, I need it to remain free of I/O so that ranking
stays testable and cannot acquire harness-specific behaviour by accident.

#### Acceptance Criteria

1. **No harness invocation.** `agents.ts` MUST NOT import or call harness or
   Orca transport code. Its existing docstring claim is tested, not merely
   stated.
2. **No Jev consultation.** `agents.ts` MUST NOT import the Jev client. Jev
   remains a controller-level concern that can only select from a pre-validated
   action set.
3. **Purity is enforced by a test**, not by convention — an import-boundary
   test over the module's dependency graph.

#### Testing

- An import-boundary test asserting `agents.ts` depends on no transport module.
- The existing plan/route tests continue to pass unchanged.

## Requirements

### R1 — One ranking

The ranking MUST be defined once and imported everywhere. Duplicated ranking
declarations MUST be removed, not synchronised.

### R2 — Eligibility before ranking

Every candidate MUST pass eligibility before ranking, on every path. No path
MAY select a candidate the planner would reject.

### R3 — Behaviour preservation

For eligible candidates, selection MUST match the current behaviour. The only
intended behavioural change is that ineligible candidates are no longer
selectable.

### R4 — Purity preserved

The planner MUST remain free of harness and Jev calls, enforced by a test.

## Out of Scope

- **Harness identity and dispatch.** That is 014.
- **The absence of a non-Orca execution path.** Separate and larger.
- **Jev's role.** Jev already cannot invent an action; it selects from a
  validated set. This spec does not change that.
- **Re-ranking policy changes.** If the current ordering is wrong, that is a
  separate decision with its own evidence. This spec removes the duplicate, it
  does not redesign the ranking.

## Success Criteria

- [ ] Ranking functions are declared in exactly one module.
- [ ] No harness can be spawned when the planner's eligibility gate rejects it.
- [ ] Characterization tests pass unchanged before and after.
- [ ] `agents.ts` has no transport or Jev dependency, proven by a test.
