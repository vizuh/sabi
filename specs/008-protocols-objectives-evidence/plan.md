# Implementation Plan: Native Protocols, Capability Evidence, Route Objectives

**Branch**: 008-protocols-objectives-evidence | **Date**: 2026-09-23 |
**Spec**: [spec.md](./spec.md)

## Summary

Add Gemini as a first-class native protocol, type the wire layer per
protocol with minimal-mutation passthrough, layer source/confidence/TTL
evidence over capabilities, and compile user objectives into eligibility
constraints over unchanged tiers.

## Technical Context

TypeScript 5.9, Node ≥22.6; server/proxy + core packages; fixture protocol
shapes regenerated on verified drift; no new runtime dependency.

## Constitution Check

- Native Harness: PASS — providers untouched; passthrough preserved.
- Evidence Before Adaptation: PASS — receipts outrank probes outrank config.
- Deterministic Safety Gates: PASS — unknown cost excludes; unsatisfiable
  refuses.
- Testable Contracts and Receipts: PASS — preservation + precedence
  fixtures.
- Privacy, Simplicity, Reversibility: PASS — field-level mutation receipts;
  tiers unchanged.

## Project Structure

```text
packages/server/src/
├── wire.ts               # WireProtocol tag + native handlers (extend/new)
└── protocols/
    └── gemini.ts         # generateContent streaming/tools (new)
packages/core/src/
├── types.ts              # CapabilityEvidence, RouteObjective, EligibilityVerdict
├── capability-evidence.ts# promotion/expiry/precedence (new)
└── objectives.ts         # objective → constraints → eligibility (new)
packages/core/test/
├── capability-evidence.test.ts
└── objectives.test.ts
packages/server/test/
└── wire-gemini.test.ts
```

**Structure Decision**: Wire handling stays server-side; evidence and
objectives are pure core; tiers are consumed, never modified.

## Delivery Waves

1. **Wire typing + Gemini**: native handlers, preservation fixtures.
2. **Minimal mutation**: diff-scoped changes with field-level receipts.
3. **Evidence registry**: promotion/expiry/precedence + routing integration.
4. **Objectives**: compiler, eligibility, refusal-with-reason.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: waves 1–2 (protocol breadth without policy change).
