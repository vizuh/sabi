# Decisions Log

Record only meaningful decisions: what, why, tradeoffs, what to revisit. Template: `www/_shared/templates/workflow/docs/decisions.md`.

---

## [2026-09-18] Product name and namespace: Sabi under vizuh/sabi

### Decision
Product name is **Sabi**; the repository lives at `github.com/vizuh/sabi` (private).

### Why
`sabi`, `uasabi` and `sabido` GitHub handles are taken; Sabido is already the name of the separate Vizuh learning product. Keeping the brand short and hosting it under the existing Vizuh namespace beats weakening the name to fit a handle.

### Alternatives considered
- Rename the product to fit an available handle — rejected; the name is the brand.
- Wait for a dedicated org handle — blocked; candidate handles are taken.

### Tradeoffs
- Repo owner reads "vizuh", not "sabi"; a later move to a dedicated org changes the URL.
- Two similarly named products (Sabi, Sabido) coexist — docs must disambiguate explicitly.

### Revisit later?
Only if the project outgrows the Vizuh namespace and a clean org handle becomes available.

---

## [2026-09-18] One monorepo with four package groups

### Decision
Single repository (`vizuh/sabi`) with planned `packages/core`, `packages/judges/jev`, `packages/evals` and `packages/adapters/{command-code,prime-agent,opencode}` — not six separate repos.

### Why
Adapters depend on a shared core contract that is still moving; one integration surface beats cross-repo versioning during the design phase.

### Alternatives considered
- Repo per component (core, each adapter, judges, evals) — rejected as premature packaging infrastructure.

### Tradeoffs
- Coarser release cadence; package boundaries must be maintained by discipline.
- A single CI surface for unrelated components.

### Revisit later?
When one adapter needs an independent release cadence or external consumers pin `core`.

---

## [2026-09-18] Docs-first bootstrap; no code scaffold

### Decision
The bootstrap ships documentation and research only (README, AGENTS/CLAUDE, context/decisions/handoff, prior-art survey). No package manifests or source scaffolding.

### Why
No component contract exists yet; empty package scaffolding would be speculative. Workspace bootstrap convention (`www/_shared/templates/workflow/bootstrap-checklist.md`) defines bootstrap as docs + registration.

### Alternatives considered
- Scaffold the TypeScript monorepo now — rejected; the stack choice was not yet a real decision.

### Revisit later?
At the first implementation task: scaffold `packages/core` with the routing-contract types, then the first adapter.

---

## [2026-09-18] Integration path: local OpenAI-compatible endpoint as a Command Code BYOK provider

### Decision
Sabi exposes a keyless, local OpenAI-compatible API (`http://127.0.0.1:8787/v1`); Command Code adds it via `~/.commandcode/providers.json` as provider `sabi`. The synthetic model id is `sabi-code`, plus fixed baseline aliases (`sabi-cheap`, `sabi-mid`, `sabi-strong`).

### Why
Command Code's documented BYOK surface accepts OpenAI-compatible or Anthropic-wire endpoints with `apiKey: false` for local servers, so no harness fork is needed. A proxy sees the full conversation on every round — exactly the trajectory state the scheduler needs.

### Alternatives considered
- Anthropic-wire proxy (`anthropic-messages`) — supported by CC and kept as an option if the wire proves limiting.
- Patching harness internals — rejected; violates the "keep the harness loop native" constraint.

### Tradeoffs
- The chat-completions format is the only signal channel (no richer harness event stream).
- Streaming must be tapped and rewritten rather than regenerated.
- The local endpoint must be running for the provider to serve anything.

### Revisit later?
When a harness exposes a richer extension surface (Prime Agent), or when a second wire is genuinely needed.

---

## [2026-09-18] Policy v0 is deterministic and heuristic; no learned routing yet

### Decision
Route by ordered conditions — `failure` (hard evidence) > `first-turn` > `verification` > `implementation` > `exploration` > `unclassified` — mapped to cheap/mid/strong tiers in `sabi.config.json`.

### Why
An auditable, tunable baseline plus a decision log before adding semantic judgments or learning. False escalations are cheap next to false downgrades on failing rounds.

### Alternatives considered
- LLM judge on every round — adds latency/cost on every call with no validation data yet.
- Learned model profiles now — no outcome data to learn from.

### Tradeoffs
- Heuristics misfire on unusual tool output; no per-repo profiles; no quota/rate-limit inputs yet.

### Revisit later?
Once the decision log has enough real rounds to measure escalation precision and savings; next steps in `docs/handoff.md`.

---

## [2026-09-18] Fixed baseline aliases alongside the adaptive model

### Decision
Expose `sabi-cheap`, `sabi-mid`, `sabi-strong` as fixed-tier aliases next to adaptive `sabi-code`.

### Why
Enables A/B comparison against fixed models on the same tasks, and isolates bugs to routing versus upstream behavior.

### Alternatives considered
- Adaptive-only — no clean baseline for the cost/quality claims.

### Tradeoffs
- More entries in `/model`; a fixed alias can be picked by accident.

### Revisit later?
After the first controlled cost/quality comparison run.

---

## [2026-09-18] Jev (TypeSafe System One) as the semantic judgment layer

### Decision
Sabi consults Jev (`jev-latest`) only on rounds the deterministic policy cannot settle — `failure` and `unclassified` — with one batched TypeSafe request covering a `noul` question ("is this a real problem the agent must fix?") and a `choice` question ("how demanding is this step?"). Thresholds: confirm escalation at ≥0.6, veto at ≤0.25, difficulty override at confidence ≥0.6. Fail-open on error or timeout.

### Why
The heuristics are cheap and mostly right; semantics are needed exactly where they are blind. Live testing had exposed a real defect: a user-requested failing command escalated a trivial round to Sonnet at 34.6k prompt tokens (~$0.069). Jev vetoes that class of escalation — verified live (real-problem 0.04 → routed to cheap) — while confirming genuine failures (0.95 → strong). Two questions in one call plus caching keeps each judgment at ~500ms and ~$0.00003.

### Alternatives considered
- Jev on every round — latency and cost on rounds the heuristics already settle.
- Replacing the deterministic policy entirely — loses the auditable baseline and the fail-open path.

### Tradeoffs
- Judged rounds pay ~0.3–0.8s before the upstream call.
- Bounded state (≤6k chars: last user instruction, last tool excerpt, round metadata; never the full conversation) is sent to `api.typesafe.ai`; the decision log still stores no prompt content.
- Thresholds are initial values that need tuning against real traffic.

### Revisit later?
After real sessions: tune thresholds from observed veto/confirm precision, then consider judgments for verification intent and repeated-failure (stuck-loop) detection.

---

## [2026-09-18] Two adapter classes: in-process mod (plan models) vs BYOK proxy

### Decision
One core, two transport classes. Class A is an in-process Command Code mod (`packages/adapters/command-code/mod/sabi.ts`) that routes with the documented `prepareNextTurn` hook — `{model, effort}` per round — and takes its signals from `afterToolCall.isError` and `onTurnEnd.usage`. Class B is the existing local OpenAI-compatible proxy, for harnesses that accept only a `baseURL`. Class-A tier→model mapping lives in `sabi.config.json` under `harness.tiers` (Command Code catalog ids, with `minPlan`); the OpenRouter `models` tiers stay as the class-B path.

### Why
Command Code's catalog models are reachable only from inside the harness: the documented BYOK surface is inbound-only (external endpoints into Command Code), and local-only mode exists specifically to stop a model id falling through to the Command Code transport. An external proxy therefore cannot route the subscription catalog under any configuration. The mod also receives ground-truth signals — the harness knows whether a tool call failed — where the proxy must infer failure from output text, and it is the only surface that can set reasoning effort, which the proxy cannot express at all.

### Alternatives considered
- Replace the proxy with the mod — rejected; harness-agnostic coverage still needs a wire-level path for harnesses with no in-process seam.
- Reverse-engineer a Command Code endpoint for the proxy — rejected; undocumented and contrary to the documented contract.
- Plan the first round too, via `cmd.setModel` in `onSessionStart` — rejected for now; it would silently override a model the user picked with `/model`.

### Tradeoffs
- Two transports to maintain, with different expressive ceilings (model + effort in-process, model name only on the wire).
- Signal fidelity differs by class, so routing quality is not comparable across classes; the eval harness must be per-class.
- The mod cannot plan the first round of a run — `prepareNextTurn` fires only on continuing rounds, so round 1 is served by the session model.

### Revisit later?
At the second adapter (Prime Agent / OpenCode): read the installed runtime first to decide which class it gets.
