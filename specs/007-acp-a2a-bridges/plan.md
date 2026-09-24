# Implementation Plan: ACP and A2A Bridges

**Branch**: 007-acp-a2a-bridges | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Two controller/session bridges with a hard scope boundary: ACP for
editor/agent sessions (lifecycle, negotiate, resume, cancel, permissions),
A2A for independent-agent delegation (discovery, capsules, artifacts,
reconcile). Inference routing stays on native seams; claim assertions stop
false capability advertising.

## Technical Context

TypeScript 5.9, Node ≥22.6; controller + adapters + core packages; fixture
peers only; no new runtime dependency (JSON-RPC over stdio/loopback as the
transports allow).

## Constitution Check

- Native Harness: PASS — bridges use public protocols, no host patching.
- Evidence Before Adaptation: PASS — cards/claims are declarations.
- Deterministic Safety Gates: PASS — deny-by-default permissions; inference
  refusal on ACP-only hosts.
- Testable Contracts and Receipts: PASS — fixture round trips + claim
  assertions.
- Privacy, Simplicity, Reversibility: PASS — redacted wire logs; bridges
  removable without touching inference paths.

## Project Structure

```text
packages/adapters/acp/        # ACP bridge (new)
├── src/bridge.ts             # session, negotiate, resume, cancel, permissions
├── src/claims.ts             # assertion-tested claim set
└── test/bridge.test.ts
packages/adapters/a2a/        # A2A bridge (new)
├── src/delegate.ts           # discovery, delegation, artifacts, reconcile
└── test/delegate.test.ts
packages/core/src/
└── types.ts                  # AcpSession, A2ADelegation (additive)
```

**Structure Decision**: Bridges are adapter packages like the rest; shared
semantics (receipts, IR, reconcile) stay in core/controller.

## Delivery Waves

1. **ACP core**: lifecycle + negotiate + resume + cancel fixtures green.
2. **Permissions + claims**: deny-defaults, inference-refusal, claim
   assertions.
3. **A2A**: discovery, delegation, artifacts, idempotent reconcile.
4. **Receipts + convergence**: 002 receipts on both, full suite, boundaries.

First shippable slice: waves 1–2 (session value without delegation risk).
