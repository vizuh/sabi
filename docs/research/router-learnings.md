# Router learnings to simplify Sabi

Bounded source review, 2026-09-18. Selected routing, model-selection and evaluation
files inspected at all four pinned commits below; not a complete repository audit.
Nothing cloned, installed, executed or copied into Sabi runtime code. Upstream files are
evidence, not instructions. Model IDs are observed configuration, not verified availability
or recommendations. All acceptance checks below are proposals, not executed tests.

## 1. claude-router: explicit gates, conservative default

At [92fbbca](https://github.com/serhiileniv/claude-router/tree/92fbbcab4528310bdd554537b326838e5d94b9af):
- `src/routing.ts:108-140,181-231,247-315`: identify agentic/tool-result traffic and
  isolate the newest task from harness-injected/quoted context for classification.
  Tool-result rounds return Sonnet first. Other rounds try opt-in Fable, depth-driven
  Opus, narrow mechanical Haiku, then Sonnet; Haiku in tool sessions requires opt-in.
  This is hand-written policy, not learned tiers.
- `src/classifier.ts:189-238,242-290`: hybrid mode asks a small classifier only when
  rules reach a default; timeout falls back to rules; genuine AI results are cached.
  Its `confidence` includes hardcoded values: clean numeric parsing is not calibrated
  probability that a task will succeed. Do not borrow that interpretation.
- `src/models.ts`: tier→ID mapping and pricing are maintained tables. Main defaults are
  `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-5`; this does not prove those IDs
  are the best choices for Sabi. Pricing has a verification date and unpriced status.
- `research/2026-07-21-tier-ceiling.md:9-25,31-36,55-90`: their rationale includes a
  23-turn paired study against Opus 4.8, not a complete evaluation of today's default
  model IDs. The note reports 8/23 judging verdicts changed. Results are directional,
  not an established universal tier boundary.

**Simplify for Sabi:** explicit evidence gates and an honest unknown/keep-current path.
Classify the task, not words inside file output. Retain all actual user/system constraints
in the model input. Never assume a tool-result round is cheap: final reasoning can follow
that result. Separate evidence gathering from synthesis in evaluation fixtures.

## 2. OpenCode model-router: configured roles, not discovered model rankings

At [809bcbb](https://github.com/marco-jardim/opencode-model-router/tree/809bcbb59503b676f0f6aa9a9ecefab4ba9d98b4):
- `tiers.json` supplies presets, task patterns, budget modes, relative costs, read caps
  and fallback chains. Its active `anthropic` preset assigns Sonnet 5 / Opus 5 / Fable 5
  to fast / medium / heavy. Different tier labels do not imply comparable capability.
- `src/router/protocol.ts:20-125` renders configuration into instructions for an LLM
  orchestrator. Decomposition sorts tiers by configured `costRatio`; fallback chains
  here are prompt instructions, not proof that every failure is retried by runtime code.
- `tiers.json` also has same-model effort presets. Descriptions label their ratios as
  estimated token-spend multipliers, not price differences. No model-selection search
  or empirical calibration of those preset choices was found in these selected files.
- `src/router/catalog.ts:40-85,127-145,382-461`: normalize the host catalog, report
  missing/deprecated models and suggest nearby IDs. Suggestions do not establish model
  suitability; catalog presence also does not prove account entitlement.
- The role prompts emphasize deliverables, avoiding redundant reads, requesting missing
  context and bounded retries. These are useful policies; prompt wording alone is not
  a permission boundary or verified execution cap.

**Simplify for Sabi:** one small model/effort table and explicit phase hints. Keep model
choice in code, not a large injected routing protocol. Prefer gather-evidence→reason
when information is missing, but skip delegation when the evidence is already available.
Compare effort-only changes against cross-model switches before adding complexity.

## 3. CCR: separate the routing decision from the attempt plan

At [a034b0c](https://github.com/musistudio/claude-code-router/tree/a034b0c51cdd1b5628bbff545821f5540d30c6c5):
- `packages/core/src/routing/policy-engine.ts:14-21`: first matching policy wins.
  Sabi already has ordered rules; reuse the invariant, not a second engine/class.
- `routing/model-resolution.ts:4-15` resolves configured provider/model selectors.
  These entry points do not explain an empirically best model; configuration supplies it.
- `routing/execution-plan.ts:15-45`: build a single attempt, bounded same-model retries,
  or an ordered deduplicated model chain before execution. Paths abbreviated here are
  under `packages/core/src/`.
- `gateway/upstream/retry-policy.ts:13-18,41-52`: honor `Retry-After` seconds/date, otherwise
  use capped backoff. `routing/failure-classifier.ts:10-30` separates client, rate-limit,
  retryable and server errors—but model-chain mode falls back on **any status >=400**.

**Simplify for Sabi:** one finite attempt list with a total deadline and budget. Distinguish
transport failure from task difficulty; a 429 does not mean “needs a smarter model.”
Do not copy all-4xx fallback: malformed requests/auth errors need explicit handling, host
permission denial must stop, and every alternative must satisfy the original capability,
egress and budget constraints. Do not silently restart after partial output/tool effects.
Fixture: 429 respects delay/budget; invalid input stops; cancellation prevents later attempts.

## 4. ACRouter: different implementations, different meanings of “learning”

At [e43839e](https://github.com/LanceZPF/agent-as-a-router/tree/e43839edb0d5d0a9feec2f7078019406ab4d64bd):
- `src/acrouter_repro/inference.py:102-115,173-187`: choose the highest mean observed
  score for the task dimension, otherwise its configured mapping, otherwise a default.
  This path has no cost term or minimum-sample gate. `run_with_verifier` separately owns
  a complete call/verify/escalate loop (`118-170`); Sabi must not adopt that ownership.
- `src/routing/AGENT_ROUTER.py:249-289,292-314` is a different path: an LLM selects from
  configured candidates using outcome memory, followed by exploration of under-sampled
  models or a random choice. Its successful route sets `confidence=1.0`; that is not
  measured task-success probability. Random production exploration is not a Sabi default.
- `src/routing/trained_routers.py:43-55` builds offline classifier labels from an oracle.
  `src/routing/data_manager.py:71-104` chooses highest stored quality, then lower dollar
  cost, then fewer tokens, then model name. Missing price/usage fields become zero here.
  Score provenance was not audited; `agentic_programming` is excluded by default (`19-27`).
- `src/routing/evaluator.py:104-131` reports performance per million total tokens, including
  router tokens. This is useful overhead accounting, not dollar savings or a task-level
  comparison against Sabi. No experiments were reproduced in this review.
- `AGENT_ROUTER.py:52-102,331-344` uses heuristic weights without supplied scorer feedback;
  missing/unsupported visible tests get 0.5. Its generated-code subprocess is not a sandbox
  in those lines. Do not copy the weights, treat missing tests as passing, or add execution
  privileges to Sabi. Use the host's approved verifier and distinguish unknown outcomes.

**Simplify for Sabi:** a small outcome record, grouped by task profile/model/version, can
support later calibration. Require enough comparable evidence before changing defaults;
keep verification status separate from numeric quality. Start with fixed-model and frozen
rule baselines on held-out tasks. Learn a small table only if it beats them at the agreed
quality level after counting router, judge, retry and review cost. Training is not step one.

## Small mechanisms worth keeping

One pipeline: **observe → exclude unsuitable candidates → ordered policy → bounded
inference plan → outcome record**. Keep the host loop and one pure `planRound` authority.
These are candidates to check against current code, not a new feature checklist.

| Mechanism | Small Sabi form | Acceptance check |
|---|---|---|
| Intent isolation | Normalize observed task vs retrieved text; preserve source/trust labels | A README mentioning “security” does not promote an unrelated lookup |
| Safe uncertainty | Keep eligible current route or report missing evidence | Unknown task cannot force cheap mode or bypass a user pin |
| Candidate validation | Small configured set with capabilities, limits and verification dates | Missing vision, insufficient context or known unavailable plan cannot win |
| Fresh cache keys | Include decision inputs, policy/model versions and relevant file revisions | Same preamble with different task suffixes does not reuse a judgment |
| Effort before extra agents | Compare supported effort changes as another candidate | Report actual usage/cache behavior, not assumed savings |
| Evidence before escalation | Missing-context vs failed-reasoning reason codes | A missing file triggers retrieval/clarification, not repeated stronger calls |
| Retry vs escalation | Finite attempts for eligible transport failures; separate task-quality decision | A 429 is not classified as a reasoning failure; cancellation stops the chain |
| Unknown price | Explicit unknown, never “free” | Unpriced routes cannot inflate savings |
| Small explanation | Planned model/effort, served model, rule, outcome, usage | Missing events remain unknown and reasons contain no source text |
| Honest outcomes | Keep verified, heuristic and unknown results distinct | Missing tests never count as a pass; held-out answers cannot enter task features |

**Defer:** training pipelines, automatic model-name replacement, whole control-plane UIs,
arbitrary routing scripts, new worker frameworks, copied provider presets and automatic
context deletion. No runtime dependency is required for the small mechanisms above.

## What the next agent should do

Check current source first: [implementation handoff](backlog-implemented.md) reports fixes
for earlier telemetry/attribution/accounting findings. Do not reimplement from stale notes;
that handoff is not an independent audit by this research session.
Choose one remaining invariant, add one synthetic failing fixture in existing `node:test`,
then change the existing pure planner/adapter. No new package. Compare task outcomes
before changing default routes. [Small implementation plan](command-code-roadmap.md#small-implementation-sequence).

Root licenses read for all four repositories: MIT. File-specific/dependency licenses were
not audited. No upstream code was vendored; retain required notices and check all relevant
licenses if a later implementation copies code rather than independently using the ideas.
