# Handoff Notes

## Current status

PR #3 merged to `main` as `7d57ff4` from `feat/multi-harness-support`. A follow-up is on `fix/sse-terminal-choice-order` for one post-terminal SSE choice guard found by final peer probing. Last full validation before this follow-up: 164 Node tests, typecheck and offline eval pass; Hermes adapter adds 12 Python tests. OpenCode 1.18.30 and Kilo CLI 7.7.4 passed real-client read tasks through Sabi + a local mock. Prime 0.9.5 passed a strict three-round proxy probe; same-parent native setters are proven ineffective and remain deferred. Hermes 0.21.3 passed the isolated Hermes → Sabi → mock probe (`mid → cheap → mid`). No paid provider certification.

## Last meaningful update

2026-09-18

## Multi-harness continuation — 2026-09-18

- User authorized all implementation phases, incremental pushes, PR and merge to main after review. Do not wait for every client before delivering tested checkpoints.
- PR #3 is merged after final review and local validation; follow-up PR #4 will carry only the post-terminal SSE guard. Root owns staging/commits/merge. Never force-push or discard parallel changes.
- Native Prime timing evidence and reproducible proxy probe: [Prime compatibility](research/prime-agent-compatibility.md). Root verified four profile tests and the strict real-client evidence.
- Hermes plugin has 12 passing tests and native standalone plus Hermes→Sabi→mock passes (`mid → cheap → mid`) in the isolated namespace. Metadata GETs still occur despite discovery-off; native routing remains gated. The proxy probe reports hashed attribution and stripped upstream headers.
- Remaining: push and peer-review the post-terminal SSE guard, merge PR #4 if checks remain green, then continue Kilo VS Code runtime validation and paid smoke separately.
- VS Code is installed as Flatpak, but its Kilo extension is absent in the inspected extension directory. No normal app profile was changed.
- Paid smoke is blocked: no `OPENROUTER_API_KEY` in the process and no approved USD cap. No credential files were searched. Ask for environment setup, never a key pasted into Git/chat.
- The shared effective request envelope is now checked for generated model/stream-usage fields and context bytes. SSE terminal-state validation, unknown served-model pricing, implicit fallback model advertising and unknown Jev usage have regression coverage. Runtime logs/isolated clients are under `.sabi/compat/` and ignored. Do not commit them. No deployment or paid inference has happened.

## What was done recently

- Built the first working Sabi: `packages/core` (trajectory-state extraction, policy v0, router, decision log), `packages/server` (OpenAI-compatible proxy on 127.0.0.1:8787 with an SSE tap that rewrites the response model back to `sabi-code`, injects `stream_options.include_usage`, and captures usage), `packages/adapters/command-code` (idempotent `~/.commandcode/providers.json` writer).
- Added the Jev judgment layer: `packages/core/src/judge.ts` (bounded state, veto/difficulty application), `packages/server/src/typesafe.ts` (TypeSafe client: retry, timeout, answer validation, cache), `judge` config block, judge stats in `npm run report`.
- Added the class-A adapter: `packages/core/src/harness.ts` (round → `TrajectoryState`, `planRound`) and `packages/adapters/command-code/mod/sabi.ts` (in-process mod returning `{model, effort}` per round). The harness's own `isError` is authoritative, so output text alone can never escalate a round.
- **Distribution (this session).** The mod is now installable: `packages/adapters/command-code/package.json` declares `{"commandcode": {"mods": ["./mod/sabi.ts"]}}`, and `cmd mods add ./packages/adapters/command-code` registers it in project scope. `loadConfig()` gained a discovery order — `$SABI_CONFIG` (alone when set) → `<cwd>` → `~/.config/sabi/` → nearest config above the installed package — replacing the repo-relative path that only worked inside this checkout; `REPO_ROOT` is gone and decisions now go to `<cwd>/.sabi/decisions.jsonl`. Bilingual docs: `README.md` (rewritten, both adapters), `README.pt-BR.md`, `docs/install.md`, `docs/install.pt-BR.md`.
- **Class A verified live** (first time it ran in a harness). `cmd -p … --mod …/mod/sabi.ts` resolved the config from a foreign working directory and switched models mid-run: turn 1 on the session model `zai-org/GLM-5.3`, turn 2 planned `exploration → cheap` and served by `deepseek/deepseek-v4-flash`, both decisions persisted as session entries, no `mod_error`.
- **Tier defaults are now plan-safe.** `harness.tiers` uses ids available from the Go plan up — cheap `deepseek/deepseek-v4-flash`, mid `gpt-5.6-luna`, strong `zai-org/glm-5.3`. The previous defaults (`claude-sonnet-5`, `claude-opus-5`) answer `403 MODEL_NOT_IN_PLAN` on this account, so every mid and strong round would have failed. See `docs/install.md` for the Pro/Max table.
- **Research backlog implemented (this session).** Content-safe telemetry (`state.ts` emits allowlisted evidence codes; `telemetry.ts` gates reasons/errors; `sabi.config.json` sets `telemetry.allowlistOnly: true`), repeated-failure and context-pressure policy rules (`stuck` first in `POLICY_ORDER`, `context-pressure` only when the window is known), per-turn round attribution in the mod (stale `servedBy`/`lastUsage` no longer re-serialize), and report accounting fixes (cached judge usage counted once, judge cost subtracted, counterfactual labeled a rate-only estimate). `harness.tiers` and `telemetry` config are validated. Canary tests prove no secret-like markers reach logs/reports/`/decisions`.
- **Retry-vs-escalation (from router-learnings).** New `transport` `FailureLevel` (`rate-limited`/`quota-exceeded`/`timeout` evidence codes), a `transport` policy rule (default `mid`) so a 429/rate-limit/timeout retries on the same tier instead of escalating to strong, and the server records upstream 429/5xx as `outcome: 'transport'` with the status. The mod's `isError` path routes a rate-limited tool to mid, never strong.
- **Offline eval harness (`packages/evals`).** Frozen task set replayed through the deterministic router vs a fixed baseline tier; reports task pass/fail/blocked, routing, cost, and quality gates. `npm run eval`. First finding: without Jev the deterministic policy over-escalates the expected-failure task (≈4x all-mid cost) — the measured reason the live proxy keeps Jev.

## Docs-only review — 2026-09-18

- [Router learnings](research/router-learnings.md): completed bounded source review of
  four pinned routers. Covers actual selection, fallbacks, learning/evaluation limits,
  and small acceptance fixtures. No copied runtime, benchmark reproduction or new code.
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

- `git fetch`; confirm `origin/main` and `origin/feat/multi-harness-support`; inspect PR #3 and the pushed review-fix checkpoint before merging.
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

- `npm test` (164 Node tests) and `npm run typecheck`; `npm run eval` is an offline repricing/evidence run, not a live benchmark.
- Class-A check without installing: `cmd -p "Read package.json and reply with only the value of its name field." --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json` — turn 2 must show a different model than turn 1.
- `-p` runs do **not** load project-scope mods (verified against a trivial drop-in mod), so headless checks must pass `--mod`. `cmd mods list` shows project sources only after the project has had a session.
- The interactive project-scope load was not observed directly (this session had no TTY): `cmd mods list` reporting `sabi · project · from local:…` is the evidence that a session in that project loads it. Everything else about the mod (factory, hooks, routing, persistence) was verified headlessly via `--mod`.
- Isolated real-client checks passed for OpenCode 1.18.30 and Kilo CLI 7.7.4 through Sabi + mock; inspect `.sabi/compat/` summaries, which are ignored and must not be committed.
- Prime 0.9.5 and Hermes 0.21.3 isolated proxy probes also passed against synthetic mocks; native Prime per-round routing and Hermes native model/effort routing remain gated.
- This host's npm config sets `omit=dev`; the repo `.npmrc` sets `include=dev` so plain `npm install` works.

## Quick restart note

Two independent ways in. **Class A (mod):** `cmd mods add ./packages/adapters/command-code` once per clone, then any session in that project routes; no keys, no proxy. **Class B (proxy):** export `OPENROUTER_API_KEY` (+ `TYPESAFE_API_KEY` for Jev), `npm start`, pick `sabi/sabi-code` in `/model`, read `.sabi/decisions.jsonl` and `npm run report`. The proxy is a foreground process, not a service — if it is down, every `sabi/*` request fails with `ECONNREFUSED 127.0.0.1:8787`.
