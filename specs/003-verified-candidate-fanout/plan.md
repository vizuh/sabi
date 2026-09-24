# Implementation Plan: Verified Candidate Fanout

**Branch**: 003-verified-candidate-fanout | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Add bounded speculative execution to the controller: a fanout planner (≤3
branches, free/cheap fixed aliases, isolation + verifier required), a safety
screen, a receipt arbitrator, surplus worker-mode for replayable operations,
and shadow policy learning for fanout decisions. Single-candidate flow stays
the default; fanout is an explicit planned action, never ambient.

## Technical Context

TypeScript 5.9, Node ≥22.6; controller + core + surplus + evals packages;
fixture workers/verifiers only; no new runtime dependency.

## Constitution Check

- Native Harness: PASS — workspaces and verifiers are host-provided.
- Evidence Before Adaptation: PASS — no promotion without `passed` receipt.
- Deterministic Safety Gates: PASS — isolation/verifier/budget preconditions.
- Testable Contracts and Receipts: PASS — every branch receipted.
- Privacy, Simplicity, Reversibility: PASS — fingerprints not contents; shadow
  policy; single-candidate fallback intact.

## Project Structure

```text
packages/core/src/
├── types.ts              # FanoutPlan, CandidateReceipt, ArbitrationOutcome, FanoutEpisode
├── fanout.ts             # planner, safety screen, arbitrator (new)
└── recovery-actions.ts   # candidate-fanout action + preconditions (extend)
packages/core/test/
├── fanout.test.ts        # bounds, refusals, arbitration, escalation (new)
└── recovery-actions.test.ts  # extend
packages/controller/src/
├── fanout.ts             # host execution of planned branches (new)
├── surplus.ts            # worker-mode for replayable ops (extend)
└── registry.ts           # branch receipt persistence (extend)
packages/evals/src/
└── tasks.ts              # fanout fixture operations (extend)
```

**Structure Decision**: Planning/arbitration are pure core; host execution is
a thin controller runner; surplus gains a worker mode beside review mode.

## Delivery Waves

1. **Planner + screen**: bounds, capability preconditions, refusal reasons.
2. **Arbitrator**: receipt arbitration, disqualification, escalation path.
3. **Controller runner**: isolated execution, budget kills, stale handling
   (fixture doubles for workspaces/verifiers).
4. **Surplus workers**: replayable classification, worker-mode ledger.
5. **Shadow policy + convergence**: episodes, gates, full suite, boundaries.

First shippable slice: waves 1–2 (planning/arbitration provable without live
execution).

## Complexity Tracking

No violations. No RL, no paid-model fanout, no ambient speculative execution.
