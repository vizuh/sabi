# Research: Evidence-Aware Adaptive Scheduler

## Evidence boundary

This document records the user's supplied synthesis of a September 18, 2026
arXiv CS batch and the repository-grounded decisions made from it. The stated
1,200-paper screening and paper-level results were not independently reproduced
in this worktree. They are design inputs, not Sabi benchmarks. Current source,
tests, and runtime receipts remain the authority for what Sabi supports.

## Decisions

### D1. Make verification a state, not only a round kind

- **Decision**: Track whether verification is not required, needed, attempted,
  passed, failed, or unknown, and require a receipt for a verified result.
- **Rationale**: The supplied harness-value and overclaiming findings both make
  release control and actual scope inspection independent from model claims.
- **Alternatives considered**: Keep verification as the existing mid-tier round
  classification only. Rejected because it cannot represent “changed but never
  checked” or “summary says pass without receipt.”

### D2. Grade recovery evidence

- **Decision**: Record observed, matched, and replayed recovery separately.
- **Rationale**: The supplied MAGMA-GEN synthesis warns that temporal adjacency
  does not establish causation.
- **Alternatives considered**: Continue using a Wilson rate over adjacent
  rounds as the sole recovery signal. Rejected because it conflates observation
  with counterfactual evidence.

### D3. Select a recovery action before a route tier

- **Decision**: Use a bounded action union for retry, evidence gathering,
  feedback repair, escalation, fresh context, rollback with reflection, and
  ask-user; choose model/harness only after the action and capability gates.
- **Rationale**: The supplied recovery, rollback, and improver papers describe
  interventions that are not equivalent to model escalation.
- **Alternatives considered**: Add more cheap/mid/strong tiers. Rejected because
  more tiers do not distinguish provider failure, missing evidence, and context
  contamination.

### D4. Use state-conditioned evidence slots

- **Decision**: Build bounded judge input from intent, mutation, failure,
  verification, constraint, prior-failure, and context-boundary slots.
- **Rationale**: The supplied Missing Complement synthesis prioritizes the
  smallest sufficient set for the next decision over the last or most similar
  excerpt.
- **Alternatives considered**: Increase the last-tool excerpt budget. Rejected
  because it increases cost without guaranteeing missing facts are present.

### D5. Keep adaptation shadow-only until gated

- **Decision**: Semantic profiles and utility candidates are reported in shadow;
  promotion requires backtest, sample, regression, and rollback gates.
- **Rationale**: The supplied self-evolution finding warns that contaminated
  learned skills can poison later decisions.
- **Alternatives considered**: Update active rules directly from logs. Rejected
  by the constitution and the feature's safety boundary.

### D6. Reuse current contracts and storage

- **Decision**: Extend current core types, decision records, controller handoff,
  receipts, and eval fixtures; add pure modules only where cohesion requires it.
- **Rationale**: The repository already has deterministic state classification,
  bounded Jev state, controller receipts, idempotency, and offline evals.
- **Alternatives considered**: Add a database, queue, or new provider. Rejected
  as unnecessary for a local, bounded, testable first slice.

## Source map supplied by the user

| Source | Design implication | Verification status |
|---|---|---|
| [How Do Agent Harnesses Create Value?](https://arxiv.org/abs/2609.20474) | Verification/release control is an independent intervention. | User-supplied synthesis; not re-run here. |
| [The Missing Complement](https://arxiv.org/abs/2609.20050) | Select state-conditioned minimal sufficient evidence. | User-supplied synthesis; not re-run here. |
| [An Empirical Study of Harness Design](https://arxiv.org/html/2609.20804) | Harness value depends on model and context budget. | User-supplied synthesis; not re-run here. |
| [Quantifying Overclaiming Propensity](https://arxiv.org/abs/2609.20812) | Track requested-scope coverage rather than self-report. | User-supplied synthesis; not re-run here. |
| [Silence Is Endorsement](https://arxiv.org/abs/2609.20211) | Preserve verification status through summaries and handoffs. | User-supplied synthesis; not re-run here. |
| [Rollback the World, Keep the Reflection](https://arxiv.org/abs/2609.18304) | Fresh context should retain a compact recovery capsule. | User-supplied synthesis; not re-run here. |
| [AgentPProf](https://arxiv.org/abs/2609.20301) | Profile semantic operations across runs. | User-supplied synthesis; not re-run here. |
| [DeltaSelect](https://arxiv.org/abs/2609.19607) | Calibrate small development eval subsets. | User-supplied synthesis; not re-run here. |
| [When Self-Evolution Backfires](https://arxiv.org/abs/2608.05810) | Gate learned rules before promotion. | User-supplied synthesis; not re-run here. |
| [LLM-as-an-Improver](https://arxiv.org/abs/2609.19515) | Use verifier feedback to repair candidates. | User-supplied synthesis; not re-run here. |
| [Closed-World Resolution](https://arxiv.org/abs/2609.19425) | Resolve tools against an exact registry before gating. | User-supplied synthesis; not re-run here. |
| [CatchBench](https://arxiv.org/abs/2608.22808) | Separate preflight, live, and post-run detection. | User-supplied synthesis; not re-run here. |

## Repository evidence used for the plan

- `packages/core/src/state.ts` already classifies round kind and allowlisted
  failure evidence.
- `packages/core/src/types.ts` already carries trajectory, judge, usage, and
  decision records with optional fields suitable for additive evolution.
- `packages/core/src/judge.ts` and `packages/controller/src/jev.ts` already
  bound judge payloads, so slot selection can remain bounded.
- `packages/core/src/recovery.ts` already has conservative recovery statistics,
  but the feature needs an explicit evidence grade and action distinction.
- `packages/controller/src/controller.ts`, `orca.ts`, `registry.ts`, and
  `types.ts` already record execution receipts, idempotency, and handoffs.
- `packages/evals` and `packages/server/src/report.ts` already provide offline
  fixtures and reports; they need richer labels rather than a new runner.

## Rejected directions for this slice

- RL or a learned router before evidence quality and replay semantics exist.
- Automatic live replay of user work.
- A universal model capability ranking based on the supplied papers.
- A claim that local offline cost repricing proves product savings.
- A new persistence service for data that can remain bounded and local.
