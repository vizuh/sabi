# Implementation Plan: Repo Context Providers and Measurement

**Branch**: 004-repo-context-and-measurement | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Consume-not-own repo intelligence, make receipts readable, measure honestly,
and spike faster IPC only on evidence. Provider interface plus router caching;
receipt-chain report views; per-task metric catalog with provenance labels;
time-boxed UDS investigation with a numeric go/no-go.

## Technical Context

TypeScript 5.9, Node ≥22.6; core/server/controller packages; fixture
providers; no new runtime dependency (UDS uses node:net only if gated through).

## Constitution Check

- Native Harness: PASS — providers are external; Sabi adapts.
- Evidence Before Adaptation: PASS — invalidation explicit; metrics labelled.
- Deterministic Safety Gates: PASS — absent provider changes nothing.
- Testable Contracts and Receipts: PASS — chain views fixture-tested.
- Privacy, Simplicity, Reversibility: PASS — redaction preserved; transport
  unchanged by default.

## Project Structure

```text
packages/core/src/
├── types.ts              # RepoContextProvider, TaskMetric, chain view types
├── repo-context.ts       # provider interface, cache, invalidation (new)
└── metrics.ts            # catalog computation with provenance labels (new)
packages/core/test/
├── repo-context.test.ts
└── metrics.test.ts
packages/server/src/
└── report.ts             # receipt chains, catalog rendering (extend)
packages/server/test/
└── report.test.ts        # extend
packages/controller/src/
└── daemon.ts             # profiling hooks only (spike reads, no change)
docs/
└── research/uds-spike.md # spike verdict with numbers (new, only if run)
```

**Structure Decision**: Two small pure core modules; report extends existing
surfaces; the daemon is instrumented, not modified, until a gated verdict.

## Delivery Waves

1. **Providers**: interface, cache, invalidation, absent-parity.
2. **Chain views**: receipt-linked report rendering with grade markers.
3. **Metric catalog**: dimensions, labels, unknown-handling, composition rule.
4. **Spike**: profile, threshold verdict, implement-or-close.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: waves 1–2 (reuse + readability without any transport
or claim changes).

## Complexity Tracking

No violations. No indexer, no analytics export, no transport change by default.
