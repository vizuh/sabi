# Harness × model × token routing

Status: phase contract plus local OpenCode model-health slice, 2026-09-20. Catalog evidence and
bounded receipt-aware fallback are implemented; live economic routing and learned policy are not.

## Route unit

Sabi must reason about an execution target, not a model name alone:

```text
(harness, model, provider/plan, effort, session)
```

The controller and the inference scheduler remain separate contracts. The controller chooses a
host session or spawn target. The host harness owns its loop and may then use Sabi for per-round
model scheduling.

## Deterministic gate before Jev

The deterministic layer owns facts and arithmetic:

1. Apply explicit user/session overrides.
2. Remove dead, unauthenticated, unavailable, quota-exhausted and incompatible targets.
3. Apply harness/model capability and modality requirements.
4. Treat a model with an explicit `free` suffix/marker as `explicit-free`; all other cost is
   `unknown` until a plan or price receipt proves it. Catalog presence is not entitlement.
5. Classify known Jev IDs as `judge`; do not offer them as coding workers.
6. Keep token usage and cost unknown when the host did not provide a receipt. Never turn missing
   input/output/cache/tool/compaction counters into zero.
7. Build the closed valid action/target set. Jev may choose only from that set and its answer is
   validated before execution.

Jev answers semantic questions such as task shape or ambiguity. Code decides eligibility, token
math, quota waits, retries and execution.

## Runtime catalog evidence

The controller probes only verified local catalog contracts:

```text
OpenCode       opencode models
Command Code   cmd --list-models
```

Each discovered catalog records model IDs, `worker`/`judge` role, explicit-free/unknown cost
class, runtime version, observation time and a SHA-256 hash of the complete command output. A
source repository/commit is recorded only when the runtime exposes one; otherwise the absence is
deliberately unverified. Raw output, credentials and transcripts are not persisted.

This means all models visible in the installed OpenCode catalog can be considered as inventory
evidence without hardcoding a mutable list. It does not mean every model is usable on the current
plan, healthy, paid/free in billing, or automatically selected.

Native OpenCode free models such as Muse Spark are a harness resource. A controller-spawned
OpenCode target can receive an exact `--model` selection. An already-running OpenCode session keeps
its current model. The Sabi proxy cannot switch a native OpenCode subscription/resource into an
upstream request.

The controller now keeps a bounded process-local health observation for a selected harness/model:
receipt latency, `ok`/`failed`/`unverifiable` outcome and sample counts. A failed preferred model is
skipped on the next fresh catalog selection when another configured worker ID is present; if all
configured IDs are unavailable, the first valid ID is retained as a fail-open choice. The health
observation is not first-token telemetry and does not prove entitlement.

## Token and learning contract

The next economic layer needs host receipts with, where available:

```text
inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
toolObservationTokens, compactionTokens, latencyMs, outcome
```

Unknown fields stay unknown. A deterministic classifier may use measured context, declared model
limits, quota state and observed outcomes; it must not estimate a paid amount from a missing price
or claim that a listed model is covered by a plan.

AgentRun-style lessons and policy compilation are evidence features, not live self-modification:
traces are retained locally, deterministic replay compares candidate policies, and a learned rule
needs a held-out acceptance check before promotion. The existing `sabi replay` is telemetry
aggregation only; it does not yet compile lessons or re-run historical routes.

SoL-Pi-style harness changes (action fusion, online compaction, observation packing and verified
evidence reduction) remain research candidates. They require a fixed capability gate, efficiency
metric, fallback and held-out evaluation before entering a host adapter.

## Acceptance gates

The current phase is complete when these remain green from a clean worktree:

```bash
npm test
npm run typecheck
```

The next phase must add live receipts for a free OpenCode model, a paid/unknown model, a quota
failure and a fallback, then prove that the model/cost/token dimensions change the bounded route.
Only after that should Sabi add learned profiles, subscription economics or automatic policy
promotion.
