# Implementation Plan: Continuity, Reliability Plane, Durable State

**Branch**: 006-continuity-reliability-durability | **Date**: 2026-09-23 |
**Spec**: [spec.md](./spec.md)

## Summary

Make switching safe (affinity pipeline), failures classed (eight-way
taxonomy → intervention families), providers boring-survivable (health,
breakers, budgets, deadlines), and controller state crash-proof
(SQLite/WAL via `node:sqlite`, JSONL as export). Pure core logic plus a
registry-backed store; no new dependency, no distributed state.

## Technical Context

TypeScript 5.9, Node ≥22.6 (`node:sqlite` ≥22.5); core/server/controller
packages; scripted chaos fixtures; user-scope 0600 store files.

## Constitution Check

- Native Harness: PASS — hosts unchanged; pinning is scheduler-side.
- Evidence Before Adaptation: PASS — classification from receipts/codes.
- Deterministic Safety Gates: PASS — required affinity and refusals first.
- Testable Contracts and Receipts: PASS — chaos + crash fixtures.
- Privacy, Simplicity, Reversibility: PASS — local store, JSONL export,
  migrations reversible.

## Project Structure

```text
packages/core/src/
├── types.ts              # ContinuityState, FailureClass, HealthRecord
├── continuity.ts         # affinity pipeline, release boundaries (new)
├── failure-class.ts      # eight-way classifier + intervention map (new)
└── reliability.ts        # breakers, budgets, backoff, deadlines (new)
packages/core/test/
├── continuity.test.ts
├── failure-class.test.ts
└── reliability.test.ts
packages/server/src/
└── dispatch.ts           # deadline/cancellation propagation (extend)
packages/controller/src/
├── store.ts              # SQLite/WAL durable state, migrations (new)
└── registry.ts           # backed by store (extend)
```

**Structure Decision**: Three small pure core modules; dispatch propagates
budgets; the registry becomes a store facade so callers are unchanged.

## Delivery Waves

1. **Continuity**: affinity pipeline + release boundaries + cache integration.
2. **Classification**: taxonomy + intervention families + planner wiring.
3. **Reliability**: health/breakers/budgets/deadlines + chaos fixtures.
4. **Durable state**: schema, migrations, crash/retention fixtures, JSONL export.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: waves 1–2 (correctness before durability).
