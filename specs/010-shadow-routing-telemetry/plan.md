# Implementation Plan: Shadow Routing and Operational Telemetry

**Branch**: 010-shadow-routing-telemetry | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Mirror live routing decisions with zero behavioral influence (`sabi shadow
on`), store them bounded with export-first compaction, expose operational
metrics in OTel/Prometheus shape, and make the corpus sliceable for future
benchmarks. Collection only — no evaluation claims.

## Technical Context

TypeScript 5.9, Node ≥22.6; core/server/controller packages; async bounded
mirror queue; 0600 user-scope store; no new runtime dependency.

## Constitution Check

- Native Harness: PASS — mirroring observes, never intercepts.
- Evidence Before Adaptation: PASS — mirrors are labeled, never benchmarks.
- Deterministic Safety Gates: PASS — mirror pressure never fails routing.
- Testable Contracts and Receipts: PASS — equivalence + bound fixtures.
- Privacy, Simplicity, Reversibility: PASS — write-time sanitization,
  bounded labels, toggleable.

## Project Structure

```text
packages/core/src/
├── types.ts              # ShadowRecord, RetentionPolicy, MetricSeries
├── shadow.ts             # mirror writer, equivalence guard, slicer (new)
└── metrics.ts            # operational series + redaction (new; 004 has task metrics)
packages/core/test/
├── shadow.test.ts
└── metrics-ops.test.ts
packages/server/src/
└── report.ts             # corpus slice views (extend)
packages/controller/src/
└── cli.ts                # sabi shadow on/off (extend)
```

**Structure Decision**: Mirror writer sits beside routing with an
equivalence assertion seam; metrics are core-pure with server rendering.

## Delivery Waves

1. **Mirror**: writer, on/off toggle, equivalence fixtures.
2. **Bounds**: retention, export-first compaction, gaps, quarantine.
3. **Metrics**: series, labels, redaction, outage fixtures.
4. **Corpus**: slicing, provenance, report views.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: waves 1–2 (collection running safely).
