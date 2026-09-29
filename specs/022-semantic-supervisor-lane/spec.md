# Feature Specification: Semantic Supervisor Lane (research)

**Feature Branch**: `spec/routing-evidence`
**Created**: 2026-09-29
**Status**: Research. No implementation until the benchmark below says D beats B.
**Issues**: #158. Related: #146 (effort source), #89 (holdout evidence), spec 021 (receipts).

**Input**: some trajectories fail because the agent loops, not because the
model is weak. openai/codex#48792 (2026-09-27): a high-effort agent re-read
oversized observations, retried against unchanged state and shipped a
fallback the user rejected. A stronger model would not have fixed that. The
Foreman pattern separates the two: a fast model estimates semantic state,
deterministic policy owns the action.

---

## What exists

- Sabi's action space: provider, model, effort, and a signal to the host.
- Jev (TypeSafe judge) already runs on judged rounds; `evidenceRedundant` is
  recorded in shadow.
- Hard evidence the router already sees: availability, quota, entitlement
  (spec 020), context size, modality, price, test outcomes.

## The lane

Optional. Per round, Jev answers independent questions, each a probability:

`worker_stuck`, `meaningful_progress`, `attempt_repeating`,
`needs_stronger_reasoning`, `needs_verification`, `off_track`.

Rules:

1. **Fail-open.** No Jev key, Jev timeout or error: routing is byte-identical
   to today.
2. **Semantic alone never escalates spend.** Escalation needs a semantic
   signal *and* hard evidence, for example
   `worker_stuck > 0.8 AND failed_attempts >= 2`. Thresholds are config, not
   code.
3. **Effort before tier** (#146). The first response to `needs_stronger_reasoning`
   is higher effort on the same model.
4. **Loops go to the host.** `attempt_repeating` or `off_track` produces a host
   signal (a hint in the brief or hook output), never a stronger model.
5. **Hard evidence is not Jev's call.** Availability, quota, entitlement,
   context, modality and price are never inputs Jev can override.
6. **Shadow first** (constitution Principle V). Phase 1 records what the lane
   would have changed in the receipt (spec 021) and changes nothing.

## Benchmark (the gate)

Same trajectories, five arms:

| Arm | Routing |
|---|---|
| A | fixed mid model |
| B | deterministic Sabi (today) |
| C | prompt-classifier router |
| **D** | Sabi + semantic lane |
| E | fixed strong model |

Measured: task success, strong-model tokens, total cost, latency, unnecessary
escalations, missed escalations, recoveries from loops.

**D must beat B** on success at equal or lower cost, or on cost at equal
success, with the holdout discipline in #89. If it does not, the lane is not
built and this spec records the result.

## Open questions (TODO — ask Hugo)

- Budget and model set for the benchmark. Free-priced models only unless Hugo
  approves spend.
- Which trajectory set: SWE-style tasks from `packages/evals`, or recorded
  real sessions (privacy review needed).
- Jev latency budget per round; above it the lane must skip, not block.

## Out of scope

- Jev choosing models directly.
- Any change to the host loop.
