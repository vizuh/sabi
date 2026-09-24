# Implementation Plan: Trajectory IR + Adapter SDK and Conformance

**Branch**: 005-trajectory-ir-and-conformance | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Define the canonical Trajectory IR and Decision envelope in core, add a
compatibility shim over current consumers, ship versioned adapter manifests,
and build `sabi adapter verify <id>` as the shared conformance suite.
Existing adapters migrate incrementally afterward; nothing is rewritten here.

## Technical Context

TypeScript 5.9, Node ≥22.6; core/controller/adapter packages; fixture
harness doubles; no new runtime dependency.

## Constitution Check

- Native Harness: PASS — translators map host events; loops untouched.
- Evidence Before Adaptation: PASS — unknowns stay unknown.
- Deterministic Safety Gates: PASS — refusal beats silent degradation.
- Testable Contracts and Receipts: PASS — the suite is the contract.
- Privacy, Simplicity, Reversibility: PASS — shim preserves current
  behavior; manifests are additive files.

## Project Structure

```text
packages/core/src/
├── types.ts              # TrajectoryIR, DecisionEnvelope, AdapterManifest types
├── ir.ts                 # translators, unknown-marking, shim (new)
├── decision.ts           # envelope rendering + refusal records (new)
└── conformance.ts        # shared check definitions (new)
packages/core/test/
├── ir.test.ts
├── decision.test.ts
└── conformance.test.ts
packages/controller/src/
└── cli.ts                # sabi adapter verify <id> (extend)
packages/adapters/*/
└── adapter.json          # manifest per adapter (new files)
```

**Structure Decision**: IR/decision/conformance are pure core; the CLI only
runs the suite; manifests live beside adapter code.

## Delivery Waves

1. **IR + shim**: types, translators for three harness shapes, compatibility
   shim, equivalence fixtures.
2. **Decision envelope**: rendering, refusal records, fallback order.
3. **Manifests**: schema, loader, accept/refuse/downgrade logic.
4. **Conformance suite**: checks, fixture adapters, CLI wiring.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: waves 1–2 (policy inputs/outputs normalized; suite
follows).
