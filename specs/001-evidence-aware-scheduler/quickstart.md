# Quickstart: Evidence-Aware Adaptive Scheduler

All scenarios are local and fixture-based. They do not need provider keys,
paid inference, a live controller daemon, or a second server.

## Prerequisites

- Node.js >=22.6
- npm dependencies installed with `npm ci`
- clean feature worktree

## Baseline evidence

Run the baseline before implementation and retain its result separately from
feature evidence:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run eval
```

`npm run eval` is an offline fixture run. Its token/cost output is not a live
benchmark and must not be reported as product savings.

## Scenario A: verification and provenance

Run the focused core evidence tests. They must prove that a mutation without a
receipt is `needed`/`unknown`, a summary cannot upgrade itself, and a verifier
receipt can close the current generation:

```sh
node --test packages/core/test/evidence.test.ts
```

Expected evidence: source tests pass; no raw prompt or credential is persisted.

## Scenario B: recovery action and attribution

```sh
node --test packages/core/test/recovery-actions.test.ts packages/core/test/recovery.test.ts
```

Expected evidence: transport failures do not escalate the same provider,
missing evidence gathers evidence, repeated failure can choose fresh context or
rollback, and temporal recovery remains `observed`.

## Scenario C: bounded judge evidence

```sh
node --test packages/core/test/judge.test.ts
```

Expected evidence: hard gates bypass the judge, state-conditioned slots are
bounded, and missing/oversized facts remain unknown.

## Scenario D: controller capsule

```sh
node --test packages/controller/test/controller.test.ts packages/controller/test/agent-route.test.ts
```

Expected evidence: a supported handoff preserves a bounded capsule; an
incompatible target remains gated; receipts and idempotency remain separate.

## Scenario E: semantic shadow report

```sh
node --test packages/core/test/profiler.test.ts packages/server/test/report.test.ts
npm run eval
```

Expected evidence: operation/model/harness summaries separate cost, latency,
coverage, verification, and evidence grades; no candidate changes active policy.

## Full acceptance

```sh
npm test
npm run typecheck
npm run eval
git diff --check
```

Report source/tests, offline fixture output, CI, live endpoint, and human
acceptance as separate layers. Do not infer deployment or real provider
performance from this quickstart.
