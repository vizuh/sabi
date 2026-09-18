# GitHub landscape — prior art for Sabi

Surveyed 2026-09-18. Method: targeted `gh search repos` queries plus direct `gh api repos/<owner>/<repo>` verification; the four closest projects' READMEs were read directly. Read-only — nothing was cloned, installed, or run. Star counts and push dates are as observed on 2026-09-18 and drift quickly.

## The gap this survey is testing

Sabi's claim: nothing packaged combines (1) per-inference-round routing *inside* an unmodified harness loop, (2) trajectory state as the routing signal (tool results, failing tests, diffs, uncertainty, context growth), (3) model profiles learned from outcome history, (4) live economics (quota, rate limits, cost), (5) a provider-agnostic synthetic model identity.

## Closest projects

### 1. serhiileniv/claude-router — 7★, pushed 2026-09-04 (closest behavioral match)

Local drop-in proxy for any Anthropic-compatible client (Claude Code, Cursor, Cline, SDK) via `ANTHROPIC_BASE_URL`. Routes each request between Haiku/Sonnet/Opus tiers using conjunctive gates on request shape (plus an optional classifier); Sonnet is the default and leaving it requires positive evidence. Its README states the bulk of projected savings "comes almost entirely from one rule: mid-loop tool steps go to Sonnet" — measured 21% saving on one live Claude Code session vs an all-Opus counterfactual; a 200-turn replay projected 35%.

Missing vs Sabi: Claude-family only; per-request gates, not trajectory-state scheduling; no learned model profiles; no quota/economics inputs beyond price; no cross-provider synthetic model.

### 2. musistudio/claude-code-router (CCR) — 37,303★, pushed 2026-09-18 (the control plane)

"One local control plane for every AI agent": connects Claude Code, Codex, Kimi CLI, OpenCode, Pi and more to chosen providers; routes, fails over, extends, observes. This is the interception layer Sabi would otherwise have to build.

Missing vs Sabi: routing intelligence remains rule/config-driven rather than scheduled against agent state; it is the plane plus rules, not the judge.

### 3. marco-jardim/opencode-model-router — 117★, pushed 2026-09-14 (same economic thesis, different mechanism)

OpenCode plugin that injects a compressed routing protocol (~3.1–4.7k chars) on every message: a mid-tier orchestrator (e.g., Sonnet) delegates tasks to @fast/@medium/@heavy tiers with cost ratios (1x/5x/20x), splits composite explore+execute tasks (~65% of real sessions; ~36% claimed savings), and offers four budget modes plus multi-provider fallback.

Missing vs Sabi: the orchestrator model stays fixed and *delegates*; there is no transparent per-round model switching, no trajectory-state scheduling, no outcome profiles — the prompt carries the policy.

### 4. LanceZPF/agent-as-a-router — 1,231★, pushed 2026-06-29 (research/benchmark anchor)

ACRouter routes coding tasks to backend models under a performance-cost tradeoff (paper arXiv 2606.22902); ships CodeRouterBench (OOD176) and gateway-level integrations with claude-code-router and cc-switch. Task-level routing with quality/cost optimization, reproducible offline.

Missing vs Sabi: selects at the task/attempt level, not per round inside an evolving trajectory. Its benchmark methodology is the most reusable asset (see below).

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

The closest behavior (mid-loop downgrades) exists inside a Claude-only, gate-based proxy. The closest economics exist as prompt-injected delegation. The closest research routes tasks, not trajectories. No verified project combines per-round trajectory scheduling with learned model profiles, live quota economics, and a provider-agnostic synthetic model — that remains Sabi's territory until proven otherwise.
