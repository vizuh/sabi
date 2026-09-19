# Handoff Notes

## Current status

`main` includes PR #22, merged as `4c88fdb`, with the user-level controller daemon, Claude/Codex hooks, the OpenCode bridge, trace schema v1 and read-only replay. The source/test boundary is validated; installed user-config mutation, live OpenCode plugin activation inside Orca, and real cross-terminal execution remain separate evidence gates. The current latest package release is `v0.1.2` at `35560c0` and publishes only `@vizuh/sabi` (the Command Code adapter). The root controller and Orca bridge are not in that npm artifact, so controller-only changes continue through source PRs rather than an artificial package tag.

## Last meaningful update

2026-09-19

## Controller host hooks and release boundary — 2026-09-19

PR #22 is merged on `main`. The supported local controller setup is `npm link` followed by
`sabi setup --hooks` (or `sabi hooks install`); hooks fail open when the daemon is unavailable, and
they do not switch a paid subscription or a harness-selected model. `sabi replay --last=<n>` is a
read-only summary of recorded controller traces and does not replay a task.

The release workflow is package-scoped: a `vX.Y.Z` tag publishes the packaged Command Code adapter
after its package version is merged, then creates the matching GitHub Release. It does not publish
the private controller or Orca bridge. Do not create a new package release for controller-only source
changes until a publishable controller artifact and versioning contract are defined.

## Provider-neutral secret loading — 2026-09-19

The proxy now loads only credential references used by the active configuration. Precedence is
existing process environment, `SABI_SECRETS_FILE`, the nearest workspace `secrets/.env`, then
`~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. The loader parses dotenv data without
executing it, keeps values in the Sabi process only, and accepts the existing HugoOS `typesafe=`
alias for `$TYPESAFE_API_KEY`.

This is deliberately independent of Orca and the harness: Command Code's mod remains keyless,
while OpenCode, Hermes, Kilo and other OpenAI-compatible clients use the local proxy and retain
their own account credentials. No secret was copied to a harness config, terminal, worktree, log
or Git. Focused config tests passed 17/17, the full suite passed 262/262, typecheck passed, and a
short startup with both shell variables unset loaded two configured keys from the HugoOS secrets
file without making a provider request.

## npm distribution — 2026-09-18

`@vizuh/sabi` is **published**: `packages/adapters/command-code/pack.mjs` bundles the mod (esbuild, devDependency only) plus the repository's default `sabi.config.json` and the root `LICENSE` into the gitignored `pkg/`, and `.github/workflows/release.yml` publishes on a `v*` tag with provenance and opens a GitHub Release with generated notes and the packed tarball. The `@vizuh` scope exists on npm (owner `atroci`), `NPM_TOKEN` is a repository secret, and the release procedure is: bump `packages/adapters/command-code/package.json`, merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`. License is MIT ("Copyright (c) 2026 Vizuh" — adjust if that holder is wrong). The source layout is untouched, so a clone keeps loading `mod/sabi.ts` in place.

`0.1.0` was published manually to claim the name; `0.1.1` is the first tag-driven release, so provenance starts there. Verified from the registry, not just locally: packument, dist-tags and visibility resolve, the tarball downloads, and the *published* bytes ran through the real mod loader in a neutral directory (turn 1 `gpt-5.6-luna` → turn 2 planned `cheap`/`exploration` on `deepseek/deepseek-v4-flash`, measured `contextTokens`, exit 0). A control run with the shipped config's `cheap` id altered to `zai-org/glm-5.3` planned exactly that value, proving the bundle reads its own shipped config rather than the repository's. Operational note, corrected after the first CI run: npm processes a new version asynchronously after publish ("may take a few minutes to become available"), and until it finishes the version document 404s while `dist-tags` still reports the previous version — the 0.1.0 window was that, not a probe-poisoned cache. Also from that run: `npm pack --pack-destination dist` needs the directory to exist, so the GitHub Release step failed once (exit 254) after a successful provenance-signed publish; `mkdir -p dist` fixed it and the `v0.1.1` Release was created manually.

**Open defect found by that control run:** when the *mod* plans `zai-org/glm-5.3` (the shipped `strong` tier), the harness fails the round with `403 Model/provider not recognized: anthropic:zai-org/glm-5.3`. Both `zai-org/GLM-5.3` and `zai-org/glm-5.3` succeed as a session model via `--model`, so the id exists — provider resolution for a mod-supplied id is what fails. Print mode refuses shell/file tools, so a failure round cannot be induced headlessly; this needs one interactive session to test candidate strong ids (`deepseek/deepseek-v4-pro`, `moonshotai/kimi-k3`, `qwen/qwen3.8-max`) and fix `harness.tiers.strong`. Pre-existing on `main`; the README's plan coverage now states it.

## Tags, Releases and languages — 2026-09-18

GitHub and npm now line up: `v0.1.0` (at `80a6ddb`, the manual publish) and `v0.1.1` (tag-driven, provenance) each have a Release carrying the exact tarball npm serves. `release.yml` checks the registry first and **skips the publish** when that version is already published — a backfilled or re-pushed tag still gets its Release, built from the registry's tarball rather than a rebuild — and Release creation is idempotent. The repository's About section is set (`gh repo edit`): description, homepage → the npm package, topics. `README.zh-CN.md` is the third language mirror (EN / PT-BR / ZH); the install guide remains EN/PT-BR.

Note: the backfilled `v0.1.0` tag left one red workflow run — that push resolved the workflow from `main` before the registry-skip guard landed, so it attempted an already-published version and npm refused with `403`. A re-run replays the old definition; the tag, Release and registry are all correct, and the guard is on `main` from #18 on.

## Limit classification — 2026-09-18

Same-day follow-up on a real plan wall. Subscription/session limit messages (`You've hit your session limit`, `Usage limit reached`, `uses your weekly limit`, `error type rate_limit`) carried no evidence at all, so such a round fell to `unclassified` — the one rule the proxy consults Jev on — and an `Error:`-prefixed limit became `hard`, escalating to strong. Measured before the change and re-measured after, with those exact strings.

Named limits are now checked before the hard patterns (`TRANSPORT_LIMIT_PATTERNS` in `state.ts`); numeric signals (429, timeout) keep the old precedence, so a failing test that prints a 429 still escalates; and the Jev criteria/instructions name the limit class so a paraphrase cannot be read as difficulty. 222 package tests (2 new), typecheck clean, `npm run eval` unchanged. Unverified: the Jev wording change, until real limit traffic reaches it.

## Compaction awareness — 2026-09-18

Branch `feat/compaction-awareness` off `main` at `79cc981`; closes the four gaps found by reviewing [picaye/jev-compaction](https://github.com/picaye/jev-compaction) against Sabi's context handling. That project was read (README only), not cloned or run; no paid inference happened here.

- **Context is measured now.** `contextTokens` = provider-billed usage for the previous round of the same session, floored at the estimate; `contextKnown` is set only then. Proxy: bounded per-session memory (identified sessions only) fed by tapped usage, plus tool-schema bytes in the estimate. Mod: the host's `usage` fills the ledger, which now recounts the whole transcript each turn instead of accumulating tool-output length.
- **A host rewrite invalidates.** A transcript below half its previous message count ⇒ `contextGeneration` advances (it is in the judge request state, so cached verdicts cannot cross the boundary) and the failure streak restarts. The host owns compaction; Sabi rewrites nothing.
- **Shadow judge question.** `evidence_redundant` rides the same batched Jev call, leniently validated, recorded as `judge.evidenceRedundant`, counted by `npm run report`. Nothing acts on it; unverified on real traffic.
- **Eval fixture.** `compaction-reset` in `TASK_SET` plus `EvalTask.compactedAfterRound`.

220 package tests (12 new; `npm test` in this checkout also runs 14 uncommitted setup-wizard tests and reports 234), typecheck clean, `npm run eval` 8 tasks / 10 rounds. Unmeasured: the boundary thresholds, and whether the shadow answer predicts anything — that is what the report counters are for.

## Multi-harness continuation — 2026-09-18

- User authorized all implementation phases, incremental pushes, PR and merge to main after review. Do not wait for every client before delivering tested checkpoints.
- PR #3 is merged after final review and local validation; follow-up PR #4 will carry only the post-terminal SSE guard. Root owns staging/commits/merge. Never force-push or discard parallel changes.
- Native Prime timing evidence and reproducible proxy probe: [Prime compatibility](research/prime-agent-compatibility.md). Root verified four profile tests and the strict real-client evidence.
- Hermes plugin has 12 passing tests and native standalone plus Hermes→Sabi→mock passes (`mid → cheap → mid`) in the isolated namespace. Metadata GETs still occur despite discovery-off; native routing remains gated. The proxy probe reports hashed attribution and stripped upstream headers.
- Remaining after PR #4: continue Kilo VS Code runtime validation and paid smoke separately; the native-routing and paid gates stay explicitly unclaimed.
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

## Media routing — 2026-09-18

- Open PR: `fix/media-routing-constraint` (worktree `sabi-e6f139d4a2fa/vision-routing`). It carries only the media/modality work; nothing else was staged.
- Root cause, from the proxy's own log: 8 of 12 recorded errors were OpenRouter `404 No endpoints found that support image input`, all routed to cheap → `deepseek/deepseek-v4-flash-0731`. Modality was not part of the state, and declared capabilities did not exist in the config, so `ensureRouteCompatible` had nothing to enforce. The mod path failed the same way but silently: the host strips images for a text-only model, so the round answered blind.
- Fix: `inputModalities`/`mediaCounts` on `TrajectoryState` (from content parts, nested tool-result content included), declared modalities per tier (`models[].capabilities.inputModalities`, `harness.tiers[].inputModalities`), and capability-aware tier selection in `route()` and `planRound()` recording `rule: capability`. Fixed aliases refuse rather than upgrade; with no capable tier the proxy refuses and the mod keeps the session model. Images are charged 1500 tokens each (the host's bound) instead of base64 length.
- Live evidence against the real upstream: exploration round with an image → served by `openai/gpt-5.6-luna`, `rule: capability`, HTTP 200; the same request on `sabi-cheap` → HTTP 400 `input modality 'image' is not supported`. 175 Node tests, typecheck clean.
- Not covered here: per-harness media shapes for Prime/OpenCode/Hermes (they should reuse `tallyMedia` once their transcript formats are verified), and refused routes are not written to the decision log — the 400 happens before a record exists.

## Consent gate — 2026-09-18

- Incident: Command Code was wired to `sabi/sabi-code` and spent real OpenRouter credit with no consent step and no runtime way to turn an upstream off. Fixed on `feat/consent-gate-upstreams` (branched fresh off `main` at `078e9b8` — this note's branch predates that fetch, so treat the PR numbers above as stale; `gh pr list` is the source of truth for merge state).
- `UpstreamEntry.enabled?: boolean` (omitted/`true` = usable), enforced at dispatch in `ensureRouteCompatible` (the one choke point every route passes through) and at Command Code registration in `connect.ts`. `connect.ts` also gained a paid/free consent question — `--paid`/`--free` flags or a bounded (30s), non-hanging TTY prompt, defaulting to free when non-interactive.
- Review caught and fixed before merge: disabling an upstream now falls back to another enabled+capable tier in `route()` instead of hard-failing every round a policy rule happened to map to it (same mechanism the existing modality fallback used, `rule: 'availability'` when that's why); `isEnabledUpstream` unified to one definition in `packages/core/src/compatibility.ts` instead of a second copy in `connect.ts`; the ESM main-module guard now resolves paths instead of a raw string compare (broke on install paths with spaces).
- Full test/typecheck/eval details: `docs/decisions.md`'s dated entry and `log.md`.
- Not done: this file's older PR-merge references above (PR #3/#4 language, 164-test count) predate several since-merged PRs (`fix/media-routing-constraint`, `fix/doc-accuracy`, `i18n-pt-br-docs`, `proxy-request-attribution`) and are stale independent of this change — worth a dedicated pass, not folded into this one.

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

- `npm test` (175 Node tests) and `npm run typecheck`; `npm run eval` is an offline repricing/evidence run, not a live benchmark.
- Media check without a harness: POST a message with an `image_url` part and a trailing tool result to the proxy — the decision must show `rule: capability`, a tier that declares `image`, and `state.mediaCounts`. The same request on a fixed alias must return 400 with `input modality 'image' is not supported`.
- Class-A check without installing: `cmd -p "Read package.json and reply with only the value of its name field." --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json` — turn 2 must show a different model than turn 1.
- `-p` runs do **not** load project-scope mods (verified against a trivial drop-in mod), so headless checks must pass `--mod`. `cmd mods list` shows project sources only after the project has had a session.
- The interactive project-scope load was not observed directly (this session had no TTY): `cmd mods list` reporting `sabi · project · from local:…` is the evidence that a session in that project loads it. Everything else about the mod (factory, hooks, routing, persistence) was verified headlessly via `--mod`.
- Isolated real-client checks passed for OpenCode 1.18.30 and Kilo CLI 7.7.4 through Sabi + mock; inspect `.sabi/compat/` summaries, which are ignored and must not be committed.
- Prime 0.9.5 and Hermes 0.21.3 isolated proxy probes also passed against synthetic mocks; native Prime per-round routing and Hermes native model/effort routing remain gated.
- This host's npm config sets `omit=dev`; the repo `.npmrc` sets `include=dev` so plain `npm install` works.

## Quick restart note

Two independent ways in. **Class A (mod):** `cmd mods add ./packages/adapters/command-code` once per clone, then any session in that project routes; no keys, no proxy. **Class B (proxy):** export `OPENROUTER_API_KEY` (+ `TYPESAFE_API_KEY` for Jev), `npm start`, pick `sabi/sabi-code` in `/model`, read `.sabi/decisions.jsonl` and `npm run report`. The proxy is a foreground process, not a service — if it is down, every `sabi/*` request fails with `ECONNREFUSED 127.0.0.1:8787`.

## Agent Controller (new, advisory-only, shadow mode)

`npm run controller -- "<request>" [--cwd=<path>] [--orchestrate] [--json]` (`packages/controller`) recommends CONTINUE/DELEGATE/SPAWN/ORCHESTRATE/ASK for a request arriving before any harness session exists — a separate surface from inference-round routing, not wired into `packages/server`. It only recommends and logs to `.sabi/controller-decisions.jsonl`; it never executes the action itself. DELEGATE is wired against Orca's real, observed envelope shape (`worktree ps --json`/`terminal list --json`, verified live against `orca-ide` 1.4.201; see `docs/decisions.md`'s dated entry) — a path-only match, not branch-aware (real entries observed with `branch: ""`). No caller in this repo invokes it yet; it's a standalone CLI to run by hand.

`packages/controller/src/agents.ts` now adds a pure capacity-aware planner. `AgentCapacity` records available/degraded/rate-limited/quota-exhausted/unavailable state and reset time; `planAgentRoute()` removes an exhausted active session when its reset wait exceeds `handoffMs + replacementExecutionMs`, reconsiders it at `resetAt`, reuses a suitable existing session before selecting a harness to spawn, and carries a structured `HandoffSnapshot` (objective, progress, changed files, branch/worktree, tests, latest results, unresolved work, failure, diff and next action). Process death, authentication loss, repeated failures, blocked/waiting state and missing capabilities are deterministic blockers before any future Jev choice. This remains a pure advisory planner: no live inventory adapter, process spawn, or automatic handoff is wired yet.

## Agent Controller dogfood review — 2026-09-19

Ran six representative requests through the real CLI with live `orca-ide` discovery. Orca exposed three connected Sabi terminals on the main worktree (`command-code`, `claude`, `codex`); no controller action was executed. The CLI recommended `DELEGATE` for a trivial request, `DELEGATE` for an existing-session review, `CONTINUE` instead of `SPAWN` for a fresh-branch request, `ORCHESTRATE` for the multi-project request, `CONTINUE` after a controlled Orca binary failure, and `ORCHESTRATE` for the explicit override flag.

This is not ready for the stated end-to-end acceptance: `cli.ts` still calls the legacy advisory `decide()` path and never calls `planAgentRoute()`, creates a handoff, selects a target, dispatches, spawns, retries, or records actual execution. Full `npm test` passed 311 tests, `npm run typecheck` passed, and the main checkout stayed clean. No repair was dispatched because manually choosing an executor would invalidate this controller dogfood.

## Orca bridge and OpenCode — 2026-09-19

Added the small `packages/adapters/orca` bridge in the same monorepo. It contributes an Orca plugin manifest, a dispatch command, and bounded worktree/agent-status event subscriptions; the controller remains responsible for routing, handoffs, spawning, and orchestration. The richer CLI path remains the fallback until Orca exposes those lifecycle operations through its plugin host.

OpenCode remains a real controller harness and spawn/orchestration candidate; the installed binary was observed as `1.18.30` and has a focused route regression test. Plugin activation/installation in the running Orca app was not claimed: the available `orca-ide` CLI help exposes no plugin install/validate command, so only manifest/bridge tests are verified here.

Verification: `npm test` passed 318 tests, `npm run typecheck` passed, and the Orca plugin tests passed 3/3. The live controller execution proofs remain recorded above; this change does not launch a paid OpenCode task.

## Installable CLI boundary — 2026-09-19

Added a real `sabi` bin to the root and controller package manifests. The local executable now exposes `route`, `status`, `agents`, `doctor`, `config`, and `logs`; `status`/`agents` read the current Orca inventory and all commands accept an explicit `--cwd`, so controller identity is not tied to the CLI process directory. The controller log reader now rejects non-object JSON rows before returning them.

This is the first installable UX slice, not the daemon claim: output explicitly reports `runtime: local-cli` and `daemon: not-configured`. No automatic Claude/Codex hooks, user service, or Orca plugin auto-install was added without a verified host contract. `npm link`/workspace linking can now expose `sabi`; packaging a public `@sabi/controller` release remains a separate delivery decision.

Verification: CLI tests 10/10, daemon tests 2/2, full suite 327/327, typecheck clean, and offline eval completed. The offline eval remains a measurement rather than a release gate.

## User-level controller daemon — 2026-09-19

Added the first ambient-runtime slice. `sabi setup` writes non-secret controller preferences under the user state directory (`~/.local/state/sabi` on Unix, `%LOCALAPPDATA%/sabi` on Windows, or `SABI_CONTROLLER_HOME` for tests) and starts a detached loopback daemon. `sabi route` uses that daemon when setup state exists and falls back to the same local controller path if the daemon cannot answer. `sabi status` and `sabi agents` query the daemon when it is running; `sabi daemon --status|--stop` manages its lifecycle.

The daemon exposes only `/health`, `/status`, and `/route` for now. It reuses the existing live Orca inventory and execution code; it does not create a second controller, database, model registry, Laya adapter, or empirical bandit. The loopback endpoint has no auth by design; `ponytail: keep it loopback-only, add per-user authentication before any non-local bind.`

`setup` detects installed harness executables and reports rules/Jev/Laya state, but deliberately reports harness hooks as `not-installed`. No Claude/Codex/OpenCode/Hermes hook or login/system-service integration was added without a verified host contract. The next evidence gate is one real post-setup route through the daemon into an Orca terminal, followed by one verified host adapter; model observatory work starts only after durable outcome signals exist.

## Controller host hooks — 2026-09-19

Added the first host-hook slice. `sabi setup --hooks` or `sabi hooks install` preserves existing Claude
and Codex JSON configuration, writes one `.sabi-backup`, and installs `UserPromptSubmit` routing;
OpenCode receives a copied `chat.message` plugin in the Sabi state directory. The hooks call daemon
`/plan` first, execute only non-`CONTINUE` actions through `/route`, and fail open when Sabi is not
configured or unavailable. A hook blocks the current prompt only after a real execution receipt.

`/plan` is intentionally separate from `/route` so planning and hook tests cannot execute twice. The
OpenCode adapter is a thin same-repo plugin and does not change the selected model or consume a paid
subscription. Installed runtime evidence: Claude Code 2.1.278, Codex 0.155.1 with stable hooks,
OpenCode CLI 1.18.31 and local `@opencode-ai/plugin` types 1.18.4. Config merge and transport tests
pass; live mutation of the user's harness configs and live OpenCode plugin activation remain
unverified and were not performed.

## Controller traces and replay — 2026-09-19

The controller record now carries trace schema v1, bounded candidate descriptors, the valid action
set, execution duration and the existing execution receipt. `sabi replay --last=<n>` reads the local
controller JSONL and reports action, rule and execution distributions without calling Orca or a
harness. This is the first replay/evaluation surface; it does not yet re-run a policy against a
historical inventory or synthesize lessons.

Verification: focused controller tests pass, including a CLI replay test and daemon trace assertions.
