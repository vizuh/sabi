# Sabi 12-month roadmap: from model scheduler to execution scheduler

**Created**: 2026-09-23 · **Horizon**: Q4 2026 → Q3 2027 · **Status**: Planned

Thesis: Sabi stops being merely a model scheduler and becomes an execution
scheduler — routing actions, evidence gathering, verification, and escalation —
without becoming the execution engine. Every quarter below is gated: a phase
ships only on green tests, bounded evidence, and explicit live boundaries.

## Where we stand (verified 2026-09-23)

| Layer | State | Evidence |
|---|---|---|
| 001 evidence-aware scheduler (49 tasks) | Implemented | `specs/001-evidence-aware-scheduler/tasks.md` all `[X]` |
| Action-before-model vocabulary (8 actions) | Implemented | `packages/core/src/recovery-actions.ts` |
| Surplus review-only slice | Implemented | `docs/specs/surplus-inference.md`, `packages/controller/src/surplus.ts` |
| Council/ledger design | Spec only | `docs/specs/surplus-council.md` ("no fan-out") |
| VNext phased plan (6 phases) | Planned | `docs/specs/adaptive-inference-scheduler-vnext.md` |
| Decision signals Phase 1 | Implemented | `docs/specs/decision-signals.md` |
| Command Code evidence parity V1 | Implemented | `docs/specs/command-code-evidence-parity.md` |
| Hermes/OMP/OpenCode adapter lanes | Ongoing | `docs/adapters/`, `docs/harnesses.md` |
| npm `@vizuh/sabi@0.2.1` | Published | Registry + provenance |

## New specs created for this roadmap

Track A — execution depth (model scheduler → execution scheduler):

| Spec | Title | Unlocks |
|---|---|---|
| `specs/002-execution-evidence-substrate/` | `ExecutionReceipt` + `ExecutionCapabilities` + verify/rollback/switch actions + adapter receipt parity | Everything below |
| `specs/003-verified-candidate-fanout/` | Bounded free-model fanout with verifier arbitration + surplus workers | Strong-model-as-fallback economics |
| `specs/004-repo-context-and-measurement/` | Consume-not-own repo providers + receipts-in-report + metric catalog + UDS spike | Trust + honest claims |

Track B — substrate breadth (compatibility + decision layer for every
harness, model, provider, and execution environment):

| Spec | Title | Unlocks |
|---|---|---|
| `specs/005-trajectory-ir-and-conformance/` | Trajectory IR + Decision envelope + adapter manifests + `sabi adapter verify` | Safe adapter growth |
| `specs/006-continuity-reliability-durability/` | ContinuityState safe switching + 8-way failure taxonomy + health/breakers/deadlines + SQLite/WAL durable state | Production-grade correctness |
| `specs/007-acp-a2a-bridges/` | ACP session bridge + A2A delegation bridge with inference-vs-controller scope guard | Editor + agent ecosystem reach |
| `specs/008-protocols-objectives-evidence/` | Native Gemini + WireProtocol minimal-mutation + capability evidence (source/confidence/TTL) + route objectives | Protocol breadth + policy engine |
| `specs/009-semantic-decision-plane/` | DecisionFrame + replaceable backends (Jev/local/LLM) + versioned questions + shadow judgments + inspect-adapter | One context, many decisions |
| `specs/010-shadow-routing-telemetry/` | `sabi shadow on` mirroring + OTel/Prometheus operational telemetry + sliceable corpus | Future benchmarks possible |
| `specs/011-huggingface-presence/` | Public trajectory API + Space demo + versioned datasets + Collection (GitHub/npm stay canonical) | Community + evidence compounding |

## Quarter plan

### Q4 2026 — Substrate (spec 002) + IR foundations (005) + shadow start (010)

Goal: every routing decision can cite a receipt, and every receipt-dependent
action is capability-gated. In parallel, normalize policy inputs and start
collecting the future.

Track A:

- 002 waves 1–2: receipt primitive + capabilities (first shippable slice).
  **Done as code**: Phase 1 merged via PR #123 (types, `receipts.ts`,
  `capabilities.ts`, 21/21 fixture tests); planner emits no new actions yet.
- 002 waves 3–4: verify-local / rollback / switch-harness + adapter parity.
- Continue adapter lanes (Hermes pinned-path gates, OpenCode proxy depth,
  OMP extension) — unchanged cadence, no new harness loops.
- Vnext mapping: completes vnext phases 1–3 alongside 001.

Track B:

- 005 waves 1–2: Trajectory IR + Decision envelope with compatibility shim
  (policy inputs/outputs normalized before adapter count grows).
- 010 waves 1–2: `sabi shadow on` mirroring running safely (collection
  starts now so Q3 evaluation has history).

**Gate**: fixture matrices green; zero receipt-dependent actions fire on
`unknown` capability; escalation precision not regressed; shadow on/off
routing equivalence byte-identical.

### Q1 2027 — Fanout (spec 003) + safety plane (006) + protocols (008)

Goal: cheap candidates compete, verifiers decide, strong models intervene
only on verified failure. Underneath, switching becomes provably safe and
the wire layer speaks Gemini natively.

Track A:

- 003 waves 1–3: planner + safety screen + arbitrator (no live execution needed
  to prove the core).
- 003 waves 4–5: controller runner on fixture doubles, surplus worker-mode
  for replayable ops.
- Surplus promotion: reviewer history advances only through the
  `surplus-inference.md` gate order (verifiers → corpus → replay/held-out).

Track B:

- 006 waves 1–3: ContinuityState affinity pipeline + 8-way failure taxonomy
  + health/breakers/budgets/deadlines with chaos fixtures.
- 008 waves 1–2: native Gemini + WireProtocol minimal-mutation passthrough.
- 005 waves 3–4: manifests + `sabi adapter verify` conformance suite.

**Gate**: 100% of promoted candidates carry `passed` receipts in fixtures;
fanout policy changes stay shadow until 001 gates pass; required affinity
pins regardless of economics; Gemini preservation fixtures green.

### Q2 2027 — Context + measurement (spec 004) + bridges + semantic plane (007, 008, 009)

Goal: stop paying rediscovery tax where providers exist; make every decision
inspectable; measure per completed task. Reach editors/agents through open
protocols and collapse N judge calls into one frame.

Track A:

- 004 waves 1–3: provider interface + caching, receipt-chain report views,
  metric catalog with provenance labels.
- First provider integrations: whichever harness exposes map/fingerprint
  surfaces first (candidate: Simplicio-class runtime, else MCP-served).
- Messaging upgrade: estimates and reports speak per-task success/cost/time;
  no local figure is presentable as a turn-level claim.

Track B:

- 007: ACP bridge (sessions) + A2A bridge (delegation) with the
  inference-vs-controller scope guard assertion-tested.
- 008 waves 3–4: capability evidence registry (source/confidence/TTL) +
  route objectives compiled onto unchanged tiers.
- 009 waves 1–3: DecisionFrame + replaceable backends + versioned
  questions; current Jev questions migrate as v1 assets unchanged.
- 006 waves 4–5: SQLite/WAL durable state with crash/retention fixtures.

**Gate**: absent-provider parity (behavior identical to today); no unlabelled
or zero-filled cost figures; redaction tests green; ACP inference-refusal
assertions hold; shadow judgments provably non-influencing.

### Q3 2027 — Convergence + review + showcase (004, 009, 010, 011)

Goal: promote what earned it, close what didn't, show the work, plan the
next horizon. Then prune: with the breadth phase complete, cut ~10% —
collapse duplicated abstractions, drop useless telemetry, remove impossible
routes — before accepting new scope.

- Promotion review: any shadow profile (001), fanout policy (003), surplus
  ranking, question version (009), or objective default with passing
  backtest + held-out + rollback evidence may graduate; everything else
  stays shadow with recorded reasons.
- UDS spike verdict from 004: implement only on measured justification,
  otherwise close with numbers.
- 010 corpus evaluation: held-out completed-task slices (success, cost,
  time per completed task vs the pre-execution-scheduler baseline) —
  reported with bounds, never as a universal claim. This is collection
  paying off, not a benchmark launch.
- 011: public trajectory API (already consumed by report/CLI), Space demo
  with figure-to-record traceability, versioned datasets with quarantine
  reports, Collection page with GitHub/npm canonical.
- 12-month retrospective + next-horizon specs. Adapter lanes continue.

**Gate**: no active-routing change without gate evidence; retrospective
written before new scope is accepted; Space/dataset checklists resolve
with tool-not-model framing intact.

## Dependency graph

```text
Track A (depth):
001 (done) ──→ 002 ──┬──→ 003 ──→ Q3 promotion review
  (Phase 1 merged #123) └──→ 004 ──→ Q3 evaluation

Track B (breadth):
002 ──→ 005 (IR/Decision) ──→ 007 (bridges) ──→ Q3 review
002 ──→ 006 (continuity/reliability/durable) ──→ Q3 review
005 ──→ 008 (protocols/objectives) ──→ Q3 review
002 ──→ 009 (semantic plane) ──→ Q3 review
009 ──→ 010 (shadow routing, corpus) ──→ Q3 evaluation ──→ 011 (HF datasets)
004 + 010 ──→ 011 (Space + presence)

docs/specs/* ──→ feed 002–011 (signals, surplus gates, parity, lanes)
adapter lanes ──→ parallel all year, feed capability declarations + manifests
```

## Non-goals for the 12 months

- Sabi-owned repo indexer, test runners, sandboxes, or harness loops.
- Paid-model fanout, RL/fine-tuning, automatic policy promotion.
- Universal cost/quality/speed claims from offline fixtures.
- Transport rewrites without a gated spike verdict.
- Mirroring Sabi/npm onto Hugging Face; training a router model; live
  Space benchmarks; editor-side ACP clients.
- Distributed/multi-host state; Redis/hosted fallback; Bedrock/Vertex
  protocols (follow-ups, same patterns).

## How to work this roadmap

1. One spec at a time, waves in order; stop on red, never weaken a requirement
   to make a task green.
2. `log.md` entry per change set; `docs/handoff.md` at each meaningful
   boundary; `docs/decisions.md` for scope verdicts (spike, promotions).
3. Evidence layers stay separate: fixtures ≠ CI ≠ live receipts; report each
   as what it is.
