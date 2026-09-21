# Implementation Plan: Evidence-Aware Adaptive Scheduler

**Branch**: 001-evidence-aware-scheduler | **Date**: 2026-09-20 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from
/specs/001-evidence-aware-scheduler/spec.md

## Summary

Extend Sabi from a state-to-tier router into an evidence-aware trajectory
controller. The first implementation makes verification, evidence provenance,
scope coverage, recovery action, and recovery evidence grade typed and
deterministic; it then feeds bounded state-conditioned evidence to the judge,
carries a compact recovery capsule through controller handoffs, and reports
semantic episodes in shadow mode. Replay is a fixture-only validation seam, not
an automatic live action. Learned profiles and utility scoring remain
shadow/backtest-only until explicit promotion gates pass.

The implementation reuses existing TrajectoryState, DecisionRecord,
EvidenceCode, JudgeRecord, controller receipts, HandoffSnapshot, decision
logs, and offline evals. It avoids a new service, database, provider, or
training loop.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js >=22.6, ESM, strict mode

**Primary Dependencies**: Existing Node standard library, node:test,
TypeScript, current Sabi core/server/controller packages; no new runtime
dependency

**Storage**: Existing bounded decision log and in-memory episode/profile
aggregation; no new persistent store in this feature

**Testing**: npm test, npm run typecheck, npm run eval, focused
node --test files, deterministic fixture tests, and a synthetic 10x
deterministic-path benchmark

**Target Platform**: Linux/macOS developer hosts where the supported harness and
Node runtime are installed

**Project Type**: TypeScript library, OpenAI-compatible local proxy, adapters,
and experimental task-level controller

**Performance Goals**: Keep the default deterministic route path bounded and
within 10% median overhead against the pre-feature fixture baseline at 10x
synthetic traffic; keep judge and handoff payloads within their existing
configured character limits

**Constraints**: Preserve native harness loops; no paid inference or credentials
in tests; no raw prompts/secrets in default telemetry; no implicit replay; no
online policy promotion; preserve optional serialized fields and fail-open
behavior

**Scale/Scope**: One local Sabi process, multiple concurrent sessions and
harnesses, 10x synthetic request volume for regression testing, and bounded
records per trajectory

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Native Harness, Bounded Scheduler: PASS. Changes are core state/decision
  helpers and supported controller handoff fields; host loops remain native.
- Evidence Before Adaptation: PASS. Evidence grades and provenance are explicit;
  observational recovery cannot become replay evidence.
- Deterministic Safety Gates: PASS. Hard transport/failure/capability gates
  remain ahead of judge and learned candidates.
- Testable Contracts and Receipts: PASS. New entities have contracts and focused
  fixture tests; receipts remain distinct from input acceptance and self-report.
- Privacy, Simplicity, and Reversibility: PASS. Records are bounded and
  allowlisted; learning is shadow-only; no new service or provider is added.

No constitution violation requires a complexity exception.

## Research and Design Decisions

- Treat the supplied paper synthesis as a design input; preserve each external
  claim as cited, bounded, and not a measured Sabi outcome.
- Add state and action contracts before adding any scoring or learning logic.
- Keep the deterministic policy as the active fallback and expose candidate
  profile/utility decisions only as shadow records.
- Grade recovery evidence as observed, matched, or replayed; only a
  fixture-safe explicit replay may produce the last grade.
- Use state-conditioned evidence slots with omission/unknown markers instead of
  increasing the transcript excerpt budget.
- Use monotonic provenance: a summary or inferred item cannot upgrade itself to
  verified; only an explicit user/tool/harness receipt can do so.
- Use existing controller handoff/receipt path for RecoveryCapsule; do not
  introduce a parallel handoff subsystem.
- Aggregate semantic episodes from sanitized decision records; do not retain raw
  prompts or tool output.

## Project Structure

### Documentation (this feature)

text
specs/001-evidence-aware-scheduler/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-evidence.md
│   ├── controller-capsule.md
│   └── eval-episode.md
└── tasks.md
text

### Source Code (repository root)

text
packages/core/src/
├── types.ts              # shared state, evidence, recovery, profile contracts
├── state.ts              # round classification and trajectory evidence inputs
├── judge.ts              # bounded state-conditioned judge evidence
├── recovery.ts           # recovery evidence and action selection
├── router.ts             # deterministic gates before model selection
├── telemetry.ts          # sanitized bounded records
├── evidence.ts           # provenance/verification/coverage helpers
├── recovery-actions.ts   # bounded recovery action planner
└── profiler.ts           # semantic episode aggregation and shadow candidates

packages/core/test/
├── evidence.test.ts
├── recovery-actions.test.ts
├── profiler.test.ts
├── state.test.ts
├── judge.test.ts
└── recovery.test.ts

packages/controller/src/
├── types.ts              # RecoveryCapsule and receipt-compatible handoff fields
├── controller.ts          # capsule creation and bounded delivery
└── registry.ts            # bounded execution/outcome persistence

packages/controller/test/
├── controller.test.ts
├── agent-route.test.ts
└── registry.test.ts

packages/evals/src/
├── tasks.ts              # coverage/verification/recovery fixture cases
├── backtest.ts            # shadow candidate comparison
└── run.ts                # PRE/LIVE/POST-labelled offline run

packages/server/src/
└── report.ts              # semantic operation report, evidence-grade split
text

**Structure Decision**: Keep the existing workspace packages and add only small
pure core modules where the current state, recovery, and report files would
otherwise become cross-purpose. Controller and eval changes extend existing
contracts. No new package or runtime service is needed.

## Delivery Waves

1. **Foundation**: constitution, typed evidence/provenance/verification/coverage,
   deterministic recovery actions, and regression tests.
2. **Decision quality**: state-conditioned judge evidence and recovery evidence
   grades, with fixture-only replay validation.
3. **Controller continuity**: bounded recovery capsule and receipt-preserving
   handoff tests.
4. **Local intelligence**: semantic episode profiler, shadow candidate lifecycle,
   and calibrated PRE/LIVE/POST eval labels.
5. **Convergence**: consistency analysis, checklists, full tests/typecheck/eval,
   performance evidence, and explicit unverified/live boundaries.

The first shippable slice is waves 1-2. Waves 3-4 can be merged only if their
tests and compatibility gates pass; active learned routing remains out of scope.

## Complexity Tracking

No violations. The feature deliberately uses existing files/logs and pure
helpers instead of a database, queue, RL loop, or new provider abstraction.
