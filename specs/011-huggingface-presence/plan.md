# Implementation Plan: Hugging Face Presence

**Branch**: 011-huggingface-presence | **Date**: 2026-09-23 | **Spec**:
[spec.md](./spec.md)

## Summary

Ship the public API first (the architectural payoff), then the Space demo
consuming it, then versioned datasets from the 010 corpus, then the
org/Collection presence. Recorded trajectories only; GitHub/npm stay
canonical; Sabi framed as tool, never model.

## Technical Context

TypeScript 5.9, Node ≥22.6; public serializer in core; Space app
(Gradio/static/Docker per verified docs) built reproducibly; dataset
builder with content hashing; no new runtime dependency in Sabi itself.

## Constitution Check

- Native Harness: PASS — presence reads Sabi outputs, touches no hosts.
- Evidence Before Adaptation: PASS — every figure traces to a record.
- Deterministic Safety Gates: PASS — redaction fail-closed; live mode off.
- Testable Contracts and Receipts: PASS — schema, quarantine, checklist
  fixtures.
- Privacy, Simplicity, Reversibility: PASS — adversarial redaction;
  additive API; presence removable.

## Project Structure

```text
packages/core/src/
├── types.ts              # public API schema types (additive)
└── public-api.ts         # serializer + redactor + versioning (new)
packages/core/test/
└── public-api.test.ts
spaces/sabi-router/       # Space app + scripted trajectory (new)
├── app.(py|js|Dockerfile)
└── trajectory.fixture.json
scripts/
└── dataset-build.ts      # corpus → sanitizer → versioned dataset (new)
docs/
└── huggingface.md        # presence checklist + canonicals (new)
```

**Structure Decision**: API and builder live in-repo and fixture-tested;
Space content and HF uploads are checklist-driven, credentials out of repo.

## Delivery Waves

1. **Public API**: schema, serializer, redaction, compatibility fixtures.
2. **Space**: scripted trajectory, honest cost panel, offline playback,
   local build/run green.
3. **Datasets**: sanitizer, reproducible builds, quarantine reports, cards.
4. **Presence**: org/Space/datasets/Collection checklist with link
   verification.
5. **Convergence**: full suite, checklist, boundaries.

First shippable slice: wave 1 (every later surface reuses the API).
