# Implementation Plan: Execution Evidence Substrate

**Branch**: 002-execution-evidence-substrate | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Add the shared deterministic substrate that specs 003/004 build on: a core
`ExecutionReceipt` primitive, a per-harness `ExecutionCapabilities` contract,
three new recovery actions (`verify-local`, `rollback`, `switch-harness`), and
one normalized receipt shape from every adapter emission path. Pure core
helpers plus thin adapter mappings; no new service, runtime, or transport.

## Technical Context

TypeScript 5.9, Node ≥22.6, ESM strict; existing core/controller/server
packages; node:test fixtures; no new runtime dependency; bounded in-memory
records only.

## Constitution Check

- Native Harness: PASS — capabilities are declared, never probed; host loops untouched.
- Evidence Before Adaptation: PASS — receipts gate actions; `unknown` never enables.
- Deterministic Safety Gates: PASS — verify/rollback/switch ordered before escalate.
- Testable Contracts and Receipts: PASS — one joinable schema, fixture matrices.
- Privacy, Simplicity, Reversibility: PASS — sanitized bounded fields, additive types.

## Project Structure

```text
packages/core/src/
├── types.ts              # ExecutionReceipt, ExecutionCapabilities, extended RecoveryAction
├── receipts.ts           # builders, fingerprints, idempotency keys, sanitizers (new)
├── evidence.ts           # receipt-backed verification transitions (extend)
├── recovery-actions.ts   # verify-local/rollback/switch-harness planning (extend)
└── capabilities.ts       # declaration, unknown-defaults, gating helpers (new)
packages/core/test/
├── receipts.test.ts
├── capabilities.test.ts
├── recovery-actions.test.ts   # extend matrix
└── evidence.test.ts           # extend
packages/controller/src/
├── registry.ts           # receipt persistence by operationId (extend)
└── types.ts              # align ControllerExecutionReceipt with core receipt id
packages/server/src/
└── report.ts             # receipt-presence columns (extend; full surfaces in 004)
adapters                 # one emitter mapping each (mod/proxy/plugin/bundle paths)
```

**Structure Decision**: One new core module for receipts, one for capabilities;
everything else extends 001 files. Adapter emitters live next to existing
adapter code, mapping host events into the core shape.

## Delivery Waves

1. **Receipt primitive**: types, builders, fingerprints, idempotency, fixtures.
2. **Capabilities**: declaration contract, unknown-default gating, planner wiring.
3. **New actions**: verify-local/rollback/switch-harness precedence + matrix.
4. **Parity**: every adapter emits the core shape; join test passes.
5. **Convergence**: full suite, typecheck, evidence boundaries, checklist.

First shippable slice: waves 1–2 (unblocks 003 design work).

## Complexity Tracking

No violations. No new service, store, provider, or transport.
