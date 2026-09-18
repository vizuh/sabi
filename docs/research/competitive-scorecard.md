# Competitive scorecard: promising MVP, advantage not yet measured

Reviewed 2026-09-18. Read-only comparison of local Sabi source and four competitors'
commit-pinned READMEs. No competitor code was run and no benchmark was reproduced.
This is an evidence comparison, not a product ranking or proof of feature absence.

## Verdict

Sabi is making useful progress on a focused Command Code integration. It does not yet
have evidence that it completes tasks more cheaply, accurately or reliably than these
projects. Keep the native, small design; prioritize outcome measurements over breadth.

Local HEAD and GitHub `main` both returned
`575c34cb5744a291b2c72595cfa187e90c457155` during this review. Installation/research docs
and newer telemetry/context/failure changes were still local uncommitted work. A GitHub
link does not deliver those changes. No commit or push was performed here.

## Sabi against its own five-part claim

| Claimed combination | Observed status | Evidence / limit |
|---|---|---|
| Per-round routing with native host loop | Implemented baseline | Command Code mod returns model/effort for continuing rounds; proxy routes each completion. First mod round stays with host. Handoff records a live smoke, not rerun here. |
| Trajectory-informed scheduling | Partial | Tool outcomes and round type are used. Local in-progress changes add repeated-failure/context rules. This is not yet a validated account of next-step intent, diffs, uncertainty and long-horizon progress. |
| Profiles learned from outcomes | Not found in reviewed implementation | Configured model tiers and Jev judgments are not outcome-trained model profiles. |
| Live quota/rate/cost scheduling | Mostly planned | Configured prices and token accounting exist. No live quota scheduler was found; report counterfactuals do not measure alternate task trajectories. |
| Provider-independent model identity | Implemented in proxy | `sabi-code` and fixed aliases exist. The native mod selects actual host catalog IDs; capability/limit compatibility still needs validation. |

Source scope: `packages/core/src/{types,policy,harness,judge}.ts`,
`packages/adapters/command-code/mod/sabi.ts`, `packages/server/src/report.ts`, README
and handoff. `packages/evals` was absent. Current local accounting work labels rate-only
estimates and adds net judge cost; that is useful but does not establish task-level savings.

## What the nearest projects already have

| Project | README evidence at pinned revision | Implication for Sabi |
|---|---|---|
| `serhiileniv/claude-router` | Loop-position gates, tool-result awareness, optional classifier, coordinator/role routing, install/doctor/stats, explicit measured-vs-assumed caveats [1] | Very close overlap. “Per-request” is not a clean distinction when each request is a model round. Learn conservative downgrades and evidence labeling; test native cross-family model/effort control as Sabi's narrower advantage. |
| `musistudio/claude-code-router` | Many host profiles, conditions on headers/bodies, retries/fallbacks, virtual models, observability and local client-key limits [2] | Broader documented gateway product. Do not rebuild its management plane. Its local limits are not proof of provider-live-quota optimization, nor does README silence prove missing state-aware extensions. |
| `marco-jardim/opencode-model-router` | Routing protocol injected into the prompt, tier delegation, task patterns, budget modes and enforcement options [3] | More documented task/delegation controls. Sabi's mod does not need that routing prompt or delegation to switch models; lower total cost/latency is still unproven. |
| `LanceZPF/agent-as-a-router` | Task-by-model CodeRouterBench, reference outputs, cached offline reproduction and integration examples [4] | More reproducible evaluation assets than Sabi currently has. Borrow the evaluation discipline, but task-level matrices cannot alone validate per-round interventions. |

Competitor savings are their own reported measurements or simulations, not independently
verified results. The claude-router README explicitly labels its session result n=1 and
its replay an upper bound holding tokens constant. The OpenCode router describes a cost
simulation; that does not prove equal quality for Sabi's tasks.

The earlier survey also lists sequential/multi-round research (LLMRouter / Router-R1).
It therefore cannot support the blanket conclusion that existing research only routes
whole tasks. Those projects were not refreshed in this four-README follow-up.

## Where Sabi has a credible direction

- Native Command Code observations and model/effort control, without replacing its loop.
- A small deterministic policy that can work without an always-on semantic judge.
- Shared policy across native and wire-level integrations, with different limits explicit.
- A candidate path to task-, context- and risk-aware routing; these remain proposed gains.

These are engineering choices, not established unique inventions or measured superiority.
A synthetic alias, cheap/mid/strong tiers and an optional classifier alone are not a moat.

Source-level follow-up: [router learnings](router-learnings.md) records mechanisms
to reuse without copying the surrounding frameworks.

## Next evidence, not more features

1. Finish and review correctness/privacy work; stabilize decision attribution, eligible
   models and context limits. Keep local work distinct from committed/delivered work.
2. Freeze a small representative task set and policy. Compare Sabi with a fixed eligible
   model under the same host, permissions, tools and limits; compare adapters separately.
   Specify quality checks and acceptable regressions before running. Include failures,
   retries, judge/review calls, cache effects, elapsed time and human intervention.
3. If the first comparisons are useful, test task profiles and optional Jev separately.
   Report sample size, uncertainty and failures. Only after evidence supports the claim,
   expand integrations or outcome learning. A small pilot is not a general benchmark.

## Pinned sources

READMEs fetched through `gh api .../readme?ref=<commit>` on 2026-09-18:

1. [claude-router](https://github.com/serhiileniv/claude-router/tree/92fbbcab4528310bdd554537b326838e5d94b9af), README lines 119–134, 153–190, 299–312.
2. [CCR](https://github.com/musistudio/claude-code-router/tree/a034b0c51cdd1b5628bbff545821f5540d30c6c5), README lines 62–70, 260–265.
3. [OpenCode model router](https://github.com/marco-jardim/opencode-model-router/tree/809bcbb59503b676f0f6aa9a9ecefab4ba9d98b4), README lines 14–44, 124–182.
4. [Agent-as-a-Router](https://github.com/LanceZPF/agent-as-a-router/tree/e43839edb0d5d0a9feec2f7078019406ab4d64bd), README lines 29–50, 214–230, 257–258.

No stars or popularity scores were used as quality evidence. No new benchmark,
pricing, model-capability or deployment claim was established by this review.
