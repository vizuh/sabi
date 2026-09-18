# Handoff Notes

## Current status

usable by others — clone + `cmd mods add` installs the class-A mod; class A verified live in a harness; research backlog implemented (content-safe telemetry, repeated-failure + context-pressure rules, round attribution); 76 tests, typecheck clean

## Last meaningful update

2026-09-18

## What was done recently

- Built the first working Sabi: `packages/core` (trajectory-state extraction, policy v0, router, decision log), `packages/server` (OpenAI-compatible proxy on 127.0.0.1:8787 with an SSE tap that rewrites the response model back to `sabi-code`, injects `stream_options.include_usage`, and captures usage), `packages/adapters/command-code` (idempotent `~/.commandcode/providers.json` writer).
- Added the Jev judgment layer: `packages/core/src/judge.ts` (bounded state, veto/difficulty application), `packages/server/src/typesafe.ts` (TypeSafe client: retry, timeout, answer validation, cache), `judge` config block, judge stats in `npm run report`.
- Added the class-A adapter: `packages/core/src/harness.ts` (round → `TrajectoryState`, `planRound`) and `packages/adapters/command-code/mod/sabi.ts` (in-process mod returning `{model, effort}` per round). The harness's own `isError` is authoritative, so output text alone can never escalate a round.
- **Distribution (this session).** The mod is now installable: `packages/adapters/command-code/package.json` declares `{"commandcode": {"mods": ["./mod/sabi.ts"]}}`, and `cmd mods add ./packages/adapters/command-code` registers it in project scope. `loadConfig()` gained a discovery order — `$SABI_CONFIG` (alone when set) → `<cwd>` → `~/.config/sabi/` → nearest config above the installed package — replacing the repo-relative path that only worked inside this checkout; `REPO_ROOT` is gone and decisions now go to `<cwd>/.sabi/decisions.jsonl`. Bilingual docs: `README.md` (rewritten, both adapters), `README.pt-BR.md`, `docs/install.md`, `docs/install.pt-BR.md`.
- **Class A verified live** (first time it ran in a harness). `cmd -p … --mod …/mod/sabi.ts` resolved the config from a foreign working directory and switched models mid-run: turn 1 on the session model `zai-org/GLM-5.3`, turn 2 planned `exploration → cheap` and served by `deepseek/deepseek-v4-flash`, both decisions persisted as session entries, no `mod_error`.
- **Tier defaults are now plan-safe.** `harness.tiers` uses ids available from the Go plan up — cheap `deepseek/deepseek-v4-flash`, mid `gpt-5.6-luna`, strong `zai-org/glm-5.3`. The previous defaults (`claude-sonnet-5`, `claude-opus-5`) answer `403 MODEL_NOT_IN_PLAN` on this account, so every mid and strong round would have failed. See `docs/install.md` for the Pro/Max table.
- **Research backlog implemented (this session).** Content-safe telemetry (`state.ts` emits allowlisted evidence codes; `telemetry.ts` gates reasons/errors; `sabi.config.json` sets `telemetry.allowlistOnly: true`), repeated-failure and context-pressure policy rules (`stuck` first in `POLICY_ORDER`, `context-pressure` only when the window is known), per-turn round attribution in the mod (stale `servedBy`/`lastUsage` no longer re-serialize), and report accounting fixes (cached judge usage counted once, judge cost subtracted, counterfactual labeled a rate-only estimate). `harness.tiers` and `telemetry` config are validated. Canary tests prove no secret-like markers reach logs/reports/`/decisions`. 76 tests pass, typecheck clean.

## Docs-only review — 2026-09-18

- [Competitive scorecard](research/competitive-scorecard.md): four commit-pinned README
  comparisons. Stronger direction than proof: loop-aware competitors already exist;
  Sabi outcome learning, live economics and task-level gains remain unproven.
- [Folder review](research/folder-review.md): source findings, privacy/accounting risks,
  and ready-to-post issue comments. No existing GitHub issues were returned, so none
  received comments and no new issue was created.
- [Command Code roadmap](research/command-code-roadmap.md): context/tool selection
  through installed 1.56.0 hooks; local-first rules and optional Jev. Proposal only.
- [Task-aware routing](research/task-aware-routing.md): security/design/infrastructure
  profiles, impact and capability gates, plus replay acceptance cases. Not implemented.
- [Small implementation sequence](research/command-code-roadmap.md#small-implementation-sequence):
  finish/test current correctness work, keep one pure planner, then add data-only
  task profiles in shadow mode. No new package or runtime dependency proposed.
- [OpenCode and terminal plan](research/opencode-terminal-plan.md): config-only custom
  provider plus the existing HTTP endpoint. CLI 1.18.30 / local plugin 1.18.4 differ;
  plugin routing is deferred. No config applied or live integration tested.
- [Prime Agent reuse](research/prime-agent-reuse.md): parent-checked installed 0.9.5
  evidence. Reuse persistent state and nonblocking progress patterns, not its runtime.
- First action for the next implementation agent: content-safe telemetry and reliable
  round attribution, then shadow-mode context/tool recommendations. Do not tune from
  token repricing alone or infer full context size from the mod's current counters.
- This review changed docs only. It did not rerun the implementation session's tests
  or live smoke. Source and install-doc changes from that session were preserved.
- Remaining doc drift: the PT-BR README and older context/log entries may still state
  content-free logging or blur proxy/mod Jev behavior. The English README now separates
  those facts. Historical entries are retained, not rewritten.

## What still needs to happen

1. Run a real session with the mod active and validate escalation precision, judge precision and savings on real work, not toy rounds. The mod logs one decision per round into the session; the proxy writes `.sabi/decisions.jsonl` + `npm run report`.
2. Tune Jev thresholds (`judge.thresholds`) from the decision log once there is real traffic; add judgments for verification intent and stuck-loop detection (repeated identical failures).
3. Improve the remaining heuristics: verification detection from command intent plus output, escalation damping, context-pressure rule (prefer a big-window model near limits).
4. Tier↔plan safety is documentation only: Sabi cannot read the account's plan, and `cmd --list-models` lists the whole catalog regardless of plan. Consider validating tiers once at mod load if the harness ever exposes the usable model set.
5. The mod has no way to show what it is doing mid-session (no `/sabi` command, no status widget) — the only evidence is the session's custom entries.
6. Economics inputs: quota/rate-limit awareness, and refresh of drifting provider prices (OpenRouter and TypeSafe).
7. Evaluation harness (`evals`) with fixed task sets; A/B `sabi-code` against `sabi-strong` using the baseline aliases. Per-class: routing quality is not comparable across adapters.
8. If a consumer ever needs Sabi without a clone: publish `@sabi/core` plus a bundled mod, or build the small control plane described in `docs/decisions.md`.

## Current blockers

None technical. Unconfirmed: business goal and success metrics (marked TODO in `docs/context.md`).

## What to check first when reopening

- `git fetch`; confirm `origin/main` matches local (the distribution work in this session is uncommitted at handoff time).
- `docs/decisions.md` — integration path, policy v0, baseline aliases, two adapter classes, distribution.
- Whether model ids/prices in `sabi.config.json` are still current — refetch the OpenRouter API, and re-check `harness.tiers` ids against the account's plan (a listed id is not necessarily a usable one).
- `.sabi/decisions.jsonl` (class B) and the session's `sabi/decision` entries (class A) for recent decisions.

## Files or areas that matter most

- `sabi.config.json` — upstreams, tiers, aliases, policy, `harness.tiers` (the product surface).
- `packages/core/src/config.ts` — config discovery order (the thing that makes a clone work elsewhere).
- `packages/core/src/state.ts` — round classification and failure heuristics (where routing quality lives).
- `packages/core/src/policy.ts` — rule order and tier decisions.
- `packages/server/src/server.ts` — proxy behavior, logging, error paths.
- `packages/adapters/command-code/mod/sabi.ts` — the class-A routing seam.

## Testing / verification notes

- `npm test` (59 tests: state, policy, judge, TypeSafe client, config discovery, harness planning, mod surface, proxy e2e) and `npm run typecheck`.
- Class-A check without installing: `cmd -p "Read package.json and reply with only the value of its name field." --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json` — turn 2 must show a different model than turn 1.
- `-p` runs do **not** load project-scope mods (verified against a trivial drop-in mod), so headless checks must pass `--mod`. `cmd mods list` shows project sources only after the project has had a session.
- The interactive project-scope load was not observed directly (this session had no TTY): `cmd mods list` reporting `sabi · project · from local:…` is the evidence that a session in that project loads it. Everything else about the mod (factory, hooks, routing, persistence) was verified headlessly via `--mod`.
- Live check of the proxy without a harness: `curl -N http://127.0.0.1:8787/v1/chat/completions` with `model: "sabi-code"` and a tool-result conversation; then `npm run report`.
- Harness check of the proxy: `cmd -p "..." --model sabi/sabi-code --skip-onboarding -t`.
- This host's npm config sets `omit=dev`; the repo `.npmrc` sets `include=dev` so plain `npm install` works.

## Quick restart note

Two independent ways in. **Class A (mod):** `cmd mods add ./packages/adapters/command-code` once per clone, then any session in that project routes; no keys, no proxy. **Class B (proxy):** export `OPENROUTER_API_KEY` (+ `TYPESAFE_API_KEY` for Jev), `npm start`, pick `sabi/sabi-code` in `/model`, read `.sabi/decisions.jsonl` and `npm run report`. The proxy is a foreground process, not a service — if it is down, every `sabi/*` request fails with `ECONNREFUSED 127.0.0.1:8787`.
