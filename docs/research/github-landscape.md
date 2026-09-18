# GitHub landscape — prior art for Sabi

Surveyed 2026-09-18. Method: targeted `gh search repos` queries plus direct `gh api repos/<owner>/<repo>` verification; the four closest projects' READMEs were read directly. Read-only — nothing was cloned, installed, or run. Star counts and push dates are as observed on 2026-09-18 and drift quickly.

Follow-up: [competitive scorecard](competitive-scorecard.md) pins four README revisions
and separates implemented Sabi behavior from roadmap claims. This survey is not proof
of uniqueness or a measured competitive lead.

## The gap this survey is testing

Hypothesis to test, not an established claim: whether a packaged system combines (1) per-inference-round routing *inside* an unmodified harness loop, (2) trajectory state as the routing signal (tool results, failing tests, diffs, uncertainty, context growth), (3) model profiles learned from outcome history, (4) live economics (quota, rate limits, cost), (5) a provider-agnostic synthetic model identity.

## Closest projects

### 1. serhiileniv/claude-router — 7★, pushed 2026-09-04 (closest behavioral match)

Local drop-in proxy for any Anthropic-compatible client (Claude Code, Cursor, Cline, SDK) via `ANTHROPIC_BASE_URL`. Routes each request between Haiku/Sonnet/Opus tiers using conjunctive gates on request shape (plus an optional classifier); Sonnet is the default and leaving it requires positive evidence. Its README states the bulk of projected savings "comes almost entirely from one rule: mid-loop tool steps go to Sonnet" — measured 21% saving on one live Claude Code session vs an all-Opus counterfactual; a 200-turn replay projected 35%.

Overlap and distinction: Claude-family routing already includes loop-position/tool-result gates and coordinator/role routing. A request can be an inference round, so “per-request” does not distinguish it from Sabi by itself. Native cross-family model/effort control is a candidate Sabi advantage; learned profiles and live provider-quota scheduling were not established by this README review and are not implemented Sabi advantages either.

### 2. musistudio/claude-code-router (CCR) — 37,303★, pushed 2026-09-18 (the control plane)

"One local control plane for every AI agent": connects Claude Code, Codex, Kimi CLI, OpenCode, Pi and more to chosen providers; routes, fails over, extends, observes. This is the interception layer Sabi would otherwise have to build.

Overlap and distinction: CCR documents body/header routing conditions, virtual models, retries/fallbacks and local client-key limits. Its gateway scope is broader than Sabi’s. Rule/config-driven routing is also Sabi’s current baseline; the README does not establish that CCR cannot support richer state-aware logic.

### 3. marco-jardim/opencode-model-router — 117★, pushed 2026-09-14 (same economic thesis, different mechanism)

OpenCode plugin that injects a compressed routing protocol (~3.1–4.7k chars) on every message: a mid-tier orchestrator (e.g., Sonnet) delegates tasks to @fast/@medium/@heavy tiers with cost ratios (1x/5x/20x), splits composite explore+execute tasks (~65% of real sessions; ~36% claimed savings), and offers four budget modes plus multi-provider fallback.

Overlap and distinction: the documented mechanism uses a primary orchestrator and tier delegation, with the prompt carrying routing guidance. Sabi’s native mod switches models without that routing prompt. This is a different control mechanism, not evidence of better cost or task quality; outcome profiles remain a Sabi roadmap item.

### 4. LanceZPF/agent-as-a-router — 1,231★, pushed 2026-06-29 (research/benchmark anchor)

ACRouter routes coding tasks to backend models under a performance-cost tradeoff (paper arXiv 2606.22902); ships CodeRouterBench (OOD176) and gateway-level integrations with claude-code-router and cc-switch. Task-level routing with quality/cost optimization, reproducible offline.

Overlap and distinction: its documented benchmark is task-by-model, whereas Sabi targets per-round interventions. Its reproducible evaluation assets are ahead of what Sabi currently supplies; the methodology is reusable, but cannot by itself validate a different per-round policy.

### 5. Tier routers / proxies around Claude Code and Codex

- duolahypercho/codex-router — 3,691★, pushed 2026-09-18. External-model router for Codex (Kimi OAuth/API, DeepSeek, migration). Provider plane, not adaptive intelligence.
- ToolMonsters/claude-code-routing — 24★. A rebuilt, measured version of "Spotify's 90% Claude Code routing setup" — a cheap model does the reading and boilerplate, a stronger model implements. Static role split.
- glidea/claude-worker-proxy — 275★. Cloudflare Worker deployment path for CCR. Infrastructure only.

### 6. Research foundations

- ulab-uiuc/LLMRouter — 2,877★, pushed 2026-09-09. Library of 16+ routing methods incl. sequential/multi-round routing.
- ulab-uiuc/Router-R1 — 151★. NeurIPS'25: multi-round routing + aggregation as a sequential decision process. Generic, not coding-harness-specific.
- ulab-uiuc/RouteProfile — 11★. Graph-based profiling for cold-start routing — relevant to building model profiles from interaction history.
- lm-sys/RouteLLM — 5,499★ (last push 2024-08). Learned strong-vs-cheap single-query routing; the historical baseline of the category.

### 7. Adjacent finds (this survey)

- u2anilgit/PromptWise — governance layer for AI coding agents (routing + audit trail + permissions).
- EmonLu/llm-inference-cost-radar — a daily radar tracking exactly this space.
- aigw-project/aigw — 70★, "intelligent inference scheduler" for large-scale serving (batching/GPU layer — a different problem).
- est4ever/HybridRoute, apraba05/morph, EastonSu/codex-subagent-pack — small/early routers and subagent packs.

## What to reuse

- **Benchmark methodology**: LanceZPF/agent-as-a-router (CodeRouterBench, performance-cost tradeoff framing).
- **Measured-savings discipline**: serhiileniv/claude-router publishes a live-session counterfactual alongside explicit "measured vs assumed" sections — adopt the same honesty format.
- **Sequential-routing framing**: ulab-uiuc/LLMRouter + Router-R1.
- **Historical model profiles**: ulab-uiuc/RouteProfile.
- **Interception plane**: musistudio/claude-code-router, if Sabi needs a gateway before native adapter hooks exist.

## Conclusion

There is substantial overlap: loop-aware proxies, prompt-based delegation, broad gateways and sequential-routing research already exist. This survey did not establish an uncontested category. Sabi’s focused opportunity is native, low-overhead routing that preserves completed-task quality; learned profiles and live economics remain work to prove, not current advantages. Use the [competitive scorecard](competitive-scorecard.md) and controlled task comparisons before making superiority or uniqueness claims.
