# Implementation Plan: Semantic Decision Plane

**Branch**: 009-semantic-decision-plane | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Generalize Jev from one optional judge into the plane: DecisionFrame with
single context assembly, three-lane replaceable backends, versioned
question assets, shadow judgments on every round, and a jevify-style
adapter inspector. Deterministic gates stay ahead; current Jev is backend
one; heuristic RoundKind stays.

## Technical Context

TypeScript 5.9, Node ≥22.6; core judge + controller CLI; fixture backends;
existing TypeSafe client reused for the Jev lane; no new runtime dependency.

## Constitution Check

- Native Harness: PASS — plane serves routing; hosts untouched.
- Evidence Before Adaptation: PASS — facts first, unknowns stay unknown.
- Deterministic Safety Gates: PASS — gates ahead; fail-open outages.
- Testable Contracts and Receipts: PASS — frame/backends/versions/shadows
  fixture-tested.
- Privacy, Simplicity, Reversibility: PASS — per-question egress; shadow
  non-influence; incremental migration.

## Project Structure

```text
packages/core/src/
├── types.ts              # DecisionFrame, SemanticBackend, QuestionDef, ShadowJudgment
├── decision-frame.ts     # assembly, cache, dependency stages (new)
├── semantic-backends.ts  # lane interface + Jev/LLM/fixture lanes (new)
├── questions/            # versioned question assets (new dir)
│   └── registry.ts
└── judge.ts              # first backend + gate reference (extend)
packages/core/test/
├── decision-frame.test.ts
├── semantic-backends.test.ts
├── questions.test.ts
└── shadow-judgments.test.ts
packages/controller/src/
└── cli.ts                # sabi inspect-adapter (extend)
scripts/
└── inspect-adapter.ts    # pattern finder + verdicts (new)
```

**Structure Decision**: Frame/backends/questions are pure core; the judge
becomes lane one; inspection is a script behind CLI.

## Delivery Waves

1. **Frame**: assembly, cache, dependency stages, gate precedence.
2. **Backends**: interface, Jev lane, LLM fallback, fixture lanes, privacy.
3. **Questions**: versioned assets, validation, backtest support.
4. **Shadows + inspector**: non-influence collection, pattern verdicts.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: waves 1–2 (frame + lanes; current Jev call sites
opt in incrementally).
