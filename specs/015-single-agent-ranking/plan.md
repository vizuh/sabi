# Implementation Plan: Single Agent Ranking

**Branch**: 015-single-agent-ranking | **Date**: 2026-09-25 | **Spec**:
[spec.md](./spec.md)

## Summary

Delete one of two copies of the agent ranking, and make the planner's
eligibility gate apply on every path that selects an agent. The behavioural
change is narrow and specific: a candidate the planner rejects can no longer be
spawned. Everything else must be unchanged.

## Technical Context

TypeScript 5.9, Node ≥22.6. Net deletion of roughly twenty lines and one
import. The risk is not the edit; it is the behavioural change, which is why
characterization tests come first.

## Constitution Check

- **Native Harness, Bounded Scheduler** — PASS, and this spec strengthens it.
  A harness the planner deems ineligible being spawned is precisely a decision
  escaping its declared bounds.
- **Evidence Before Adaptation** — PASS. Two copies of "who is best" is a
  contradicted fact presented as a decision. Consolidation makes the evidence
  single-sourced.
- **Deterministic Safety Gates** — PASS. The eligibility gate is the safety
  gate; the defect is that one path bypasses it.
- **Testable Contracts and Receipts** — PASS. Purity becomes a test rather than
  a docstring.
- **Privacy, Simplicity, Reversibility** — PASS. Deletion, and the behavioural
  delta is bounded and specified.

## Project Structure

```text
packages/controller/src/
├── agents.ts        # the surviving ranking + eligibility; gains the import test
├── controller.ts    # duplicate ranking deleted; imports from agents.ts
└── purity.test.ts   # NEW: import-boundary assertions
```

No new modules. This is a deletion spec.

## Design Decisions

### The planner wins

`agents.ts` survives, not `controller.ts`, because it is already the documented
pure planner with a docstring claiming purity and an exported entry point. The
controller's copies have no such standing. Consolidating onto the documented one
preserves the architectural intent rather than inverting it.

### Eligibility moves to the shared path, not the call site

The defect is that `bestSession`/`bestHarness` rank without applying the
planner's gate. The fix is not "remember to call `eligibility` at each site" —
that is how the second copy arose. Eligibility MUST be part of the shared
ranking entry point, so a future call site cannot omit it by accident.

### Consolidation is a deletion, not a synchronisation

Two copies kept in step by hand is the failure mode that produced this bug. The
task is to remove one. A reviewer should be able to confirm the second
declaration is gone rather than re-reading both.

### Characterization before change

The narrowest credible claim is "eligible selection is unchanged". That is only
provable with tests written first, against today's behaviour, that pass both
before and after. Writing them after the change proves nothing.

### Purity becomes a test

`agents.ts` claims in a docstring that it never calls a harness or invokes Jev.
That claim is currently unenforced and could be broken by an innocent import. An
import-boundary test over its dependency graph makes it a constraint rather than
a comment.

## Phase Order

1. **Characterization tests** — against current behaviour, passing.
2. **Failing regression** — demonstrating an ineligible harness is selectable.
3. **Consolidation** — delete the duplicate, route eligibility through the
   shared path.
4. **Purity boundary test.**

Steps 1 and 2 must be complete and committed before 3, or the fix is
unprovable.

## Verification Strategy

- Characterization tests run against the pre-change code and recorded, so the
  post-change run is a genuine comparison rather than a fresh assertion.
- The regression test is behavioural: it asserts which agent is selected, never
  which function was invoked.
- Purity is asserted over the module graph, so a future import is caught at CI
  rather than in review.
- The full controller suite runs unchanged. Any behavioural difference it
  surfaces is a finding, not noise to be updated away.
