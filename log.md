# Sabi — change log

Append-only, newest last. Entry format: `## [YYYY-MM-DD] type | title`.

## [2026-09-18] change | bootstrap Sabi

Created the Sabi product repo at `www/products/sabi` (remote: https://github.com/vizuh/sabi, private, empty before this commit). Docs-first bootstrap: README, AGENTS.md/CLAUDE.md, `docs/context.md`, `docs/decisions.md`, `docs/handoff.md`. Captured a verified prior-art survey at `docs/research/github-landscape.md` (nine repositories checked via `gh api` on 2026-09-18; four READMEs read directly; no clones, installs or runs). Registered in `www/_index/projects-index.md`.

No runtime code, no deployment, no external publication. Initial commit pushed to `origin/main` at `809edf1`.

## [2026-09-18] change | MVP: Sabi serves Command Code as a BYOK provider

Built the first testable Sabi. `packages/core`: trajectory-state extraction (round kind, failure heuristics, context size), deterministic policy v0 (failure > first-turn > verification > implementation > exploration > unclassified), router, JSONL decision log with cost estimation. `packages/server`: OpenAI-compatible proxy on `127.0.0.1:8787` with an SSE tap that rewrites the response model to the alias, injects `stream_options.include_usage`, captures usage, and logs decisions (metadata only, never prompt content); `/v1/models`, `/healthz`, `/decisions`; `npm run report` aggregates savings vs an all-strong counterfactual. `packages/adapters/command-code`: idempotent writer for `~/.commandcode/providers.json` (installed: provider `sabi`, models `sabi-code`, `sabi-cheap`, `sabi-mid`, `sabi-strong`; `sabi-code` context window 1,000,000 derived from the policy's tiers).

Tiers wired to OpenRouter models verified live on 2026-09-18 (`deepseek/deepseek-v4-flash-0731`, `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`) plus Ollama `qwen2.5-coder:7b` as `local` (not exposed to Command Code — 32k window). 23 tests pass, typecheck clean. Live verification: `cmd -p ... --model sabi/sabi-code` routed first-turn→mid, `read_file` round→cheap, failing-test round→strong; 7 decisions logged (~$0.0104 vs ~$0.1329 all-strong counterfactual on a tiny sample — not a benchmark).

No deployment, no publication, no harness modifications. Added `.npmrc` (`include=dev`): this host's npm config sets `omit=dev`, which would skip typescript/@types/node.

## [2026-09-18] change | Jev judgment layer (TypeSafe) live in the routing path

Added `packages/core/src/judge.ts` — bounded judge state (≤6k chars: last instruction, last tool excerpt, round metadata), a `noul` question ("is this a real problem or an expected outcome?") and a `choice` question ("how demanding is the step?"), plus override logic (veto escalation ≤0.25, confirm ≥0.6, difficulty override at confidence ≥0.6) — and `packages/server/src/typesafe.ts` — TypeSafe System One client (`POST /v1/systemone`, `jev-latest`) with answer validation, one retry on 429/529/5xx, timeout, LRU cache, and fail-open behavior. Judge runs only on `failure` and `unclassified` rounds (config `judge.callOn`), before forwarding; its outcome, latency, token cost and override direction are recorded on the decision and summarized in `npm run report`.

Validation: 41 tests pass (state, policy, judge application, TypeSafe client against mocked responses, proxy e2e with a stubbed Jev) and typecheck is clean. Live TypeSafe calls confirmed the fix for the previously observed false escalation — a user-requested failing command now routes to cheap (real-problem 0.04, difficulty trivial) instead of Sonnet, while genuine failing tests still escalate (real-problem 0.95) — verified both by direct proxy calls and by a real Command Code headless session (`cmd -p ... --model sabi/sabi-code`). Judge latency 0.3–0.8s, ~650 input tokens (~$0.00003) per judged round; `report` shows 1 downgrade from 2 judged rounds in this sample (not a benchmark).

TypeSafe price ($0.042/Mtok input, output free) taken from the live docs on 2026-09-18 and recorded in `sabi.config.json`. No publication, no deployment, no harness modifications.

## [2026-09-18] change | Class-A adapter: Command Code mod over the shared core

Added the in-process adapter. `packages/core/src/harness.ts` (+7 tests) maps harness signals to `TrajectoryState` and plans a round: `trajectoryFromRound` reuses the existing `classifyRound`/`detectFailure`, but a tool's own `isError` is now authoritative and output text alone can never escalate a round — which removes the false-escalation class the proxy suffers from. `packages/adapters/command-code/mod/sabi.ts` registers `onTurnStart`/`afterToolCall`/`prepareNextTurn`/`onTurnEnd`, returns `{model, effort}` per round, keeps durable counters in `state.modState['sabi']`, logs one entry per round through `ctx.session.appendCustomEntry`, and never rewrites what the model sees.

`packages/adapters/command-code/types/commandcode-harness.d.ts` is a minimal ambient shim for `@commandcode/harness` (not published to npm), covering only the surface used, so `npm run typecheck` stays honest. `prepareNextTurn` verified present in the shipped `cli.mjs` before relying on it.

`sabi.config.json` gains `harness.tiers` — Command Code catalog ids verified 2026-09-18 against `cmd --list-models` and the bundled `models.md`: cheap `deepseek/deepseek-v4-flash`, mid `claude-sonnet-5` (Pro+), strong `claude-opus-5` (Max), all at effort `high` so the first comparison isolates the model axis. The OpenRouter `models` tiers are untouched and remain the class-B path.

52 tests pass, typecheck clean. Not yet loaded into a live harness session (`npm run mod`).

## [2026-09-18] change | Installable by others: mod package, config discovery, plan-safe tiers, EN/PT-BR docs

Made Sabi installable on someone else's machine without publishing anything and without a server. `packages/adapters/command-code/package.json` now declares `{"commandcode": {"mods": ["./mod/sabi.ts"]}}`, so `cmd mods add ./packages/adapters/command-code` registers it in project scope (`cmd mods list` → `sabi · project · from local:…`). `packages/core/src/config.ts` gained a discovery order — `$SABI_CONFIG` (alone when set) → `<cwd>` → `~/.config/sabi/` (honours `XDG_CONFIG_HOME`) → nearest config above the installed package — replacing the repo-relative path that only worked inside this checkout; `REPO_ROOT` is gone and the decision log is now `<cwd>/.sabi/decisions.jsonl` (`$SABI_LOG` overrides).

`harness.tiers` defaults changed to ids available from the **Go** plan up (cheap `deepseek/deepseek-v4-flash`, mid `gpt-5.6-luna`, strong `zai-org/glm-5.3`). Verified live on this account: `claude-sonnet-5` and `claude-opus-5` answer `403 MODEL_NOT_IN_PLAN`, while luna, glm-5.3 and kimi-k3 run — and `cmd --list-models` lists the whole catalog regardless of plan, so a listed id is not a usable id. Routing to an out-of-plan model fails the round, which the previous defaults would have done on every mid and strong round.

Live verification of the class-A adapter (first time it has actually run in a harness): `cmd -p … --mod …/mod/sabi.ts` loaded the mod, resolved the config through the discovery order from a foreign working directory, and switched models mid-run — turn 1 served by `zai-org/GLM-5.3` (session model), turn 2 planned as `exploration → cheap` and served by `deepseek/deepseek-v4-flash`, with both decisions persisted as session entries. No `mod_error` events. Also verified: `-p` runs do not load project-scope mods (a trivial drop-in mod behaves the same), so headless checks must pass `--mod`; `cmd mods list` shows project sources only after the project has had a session.

Docs: `README.md` rewritten around the two adapters with both install paths, plus new bilingual guides `docs/install.md` / `docs/install.pt-BR.md` and a PT-BR mirror `README.pt-BR.md`. 59 tests pass (7 new config-discovery tests), typecheck clean. Repo stays private; nothing published, nothing hosted.

## [2026-09-18] research | Command Code-first routing review (docs only)

Added `docs/research/folder-review.md` (package findings and ready-to-post issue comments), `docs/research/command-code-roadmap.md` (context/tool routing proposals and acceptance checks), and `docs/research/prime-agent-reuse.md` (installed Prime evidence, parent-checked). Updated the English README to separate mod/proxy behavior and remove the content-free telemetry claim; linked the research from README and handoff. Preserved concurrent source, installation docs and earlier log entries.

Recommendation: keep Command Code's loop native; fix content-safe telemetry and round attribution first, then evaluate context/tool recommendations in shadow mode. Reuse Prime's persistent-state, nonblocking-work and progress patterns, not its Python runtime. Jev remains optional; a future Prime per-round adapter is not verified by this review.

Evidence/validation: read Command Code 1.56.0 bundled contracts and shipped CLI; read Prime Agent 0.9.5 installed source/docs; fetched TypeSafe's documentation index, state, confidence and skill-suggestion pages (no TypeSafe inference). Checked 17 local Markdown links, 14 inspected source paths and static runtime anchors; inspected source remained unchanged during review. Docs whitespace check passed. No build/test or live routing run was performed; prior implementation-run results remain attributed to that session. Remaining risks include experimental hooks, incomplete routing state, telemetry privacy, unmeasured task-level savings and stale claims in the PT-BR README/older docs.

GitHub reads returned no open or closed issues for private `vizuh/sabi`, so no comments were posted and no issues created. Actionable comment text is saved in the folder review. No source/config changes, installs, commits, pushes or deployments by this review.

## [2026-09-18] research | Task-aware routing readiness

Added `docs/research/task-aware-routing.md` and linked it from the roadmap and handoff. Current source has round/tool heuristics, not domain, impact, authority or modality-aware routing. Proposed one engine with composable security/design/infrastructure profiles; keep risk, difficulty and permissions separate. Included evidence requirements, host boundaries and six replay scenarios for the next implementation agent. Domain readiness and model rankings remain unverified.

Validation: re-read core state/policy/judge and the Command Code mod; read the installed design skill dispatcher. Checked local links and docs whitespace. Docs only: no tests, live provider calls, source/config changes or issue posts.

## [2026-09-18] research | Small dependency-light implementation sequence

Added a three-patch sequence to `docs/research/command-code-roadmap.md` and linked it from the handoff: finish current correctness changes; keep one pure planning path behind both adapters; then add data-only task profiles in shadow mode. Checked manifests: core declares no runtime dependencies; adapter and server depend only on the internal core. Proposed no new packages, services or runtime dependencies. Config/log modules can remain where they are; pure planner imports must stay I/O-free.

Concurrent source changes for telemetry/context/repeated failures were observed and preserved, not validated as complete. Suggested focused fixtures for rule precedence, failure identity, unknown context and round attribution. This change set is documentation only; local links and whitespace checked, no source edits, tests/builds, installs, issue posts or live routing runs.

## [2026-09-18] research | OpenCode and plain-terminal integration plan

Added `docs/research/opencode-terminal-plan.md`, linked from the roadmap and handoff. Plan: reuse the existing Sabi proxy for an OpenCode custom provider and plain HTTP terminal calls; normalize host-specific tool observations and test transport before any pilot. Defer a plugin, new adapter package or convenience CLI until needed. OpenRouter is already supported by the existing upstream path; a direct OpenRouter call would bypass Sabi.

Evidence: installed OpenCode `--version` returned 1.18.30; help/run-help confirmed CLI flags. Local plugin package/types are 1.18.4, so no next-round plugin contract is assumed. Read official OpenCode providers/tools/CLI and OpenRouter quickstart pages on 2026-09-18; inspected Sabi's server/upstream code. No credential or session files read. Verified JSON examples parse, local doc links resolve and whitespace is clean. The configuration example remains a skeleton needing model limits/capabilities and restrictive host permissions. No source/config edits, installs, service starts, model calls, tests/builds, issue posts, commits or pushes by this review.

## [2026-09-18] change | Implement the research backlog: telemetry, repeated failures, attribution, accounting

Implemented the highest-value fixes from `docs/research/folder-review.md` and `command-code-roadmap.md` (all three workstreams), with the acceptance checks they named.

**Telemetry privacy.** `packages/core/src/state.ts` now emits allowlisted evidence codes (`fail-marker`, `nonzero-exit`, …) instead of raw output excerpts; `packages/core/src/telemetry.ts` adds a policy gate: reasons are kept only when they end in an allowlisted code, provider errors are redacted to a kind + first line, and `sabi.config.json` sets `telemetry.allowlistOnly: true` (snippet capture is an explicit opt-in). The proxy and the mod both run reasons/errors through the policy; canary tests prove secret-like markers in prompts, tool output and errors never reach logs, reports or `/decisions`.

**Repeated-failure (stuck) and context-pressure rules.** `TrajectoryState` gains `repeatedFailure`/`failureStreak`/`contextTokens`/`contextKnown`/`contextWindow`; `trajectoryFromRound` detects the same hard failure as the previous round; `policy.ts` adds `stuck` (first in the order) and `context-pressure` conditions. Repeated failures route to the stuck tier (configurable via `policy.stuck`) instead of escalating forever. The mod tracks previous-round state so the rule fires through the full lifecycle.

**Round attribution.** The mod previously re-serialized stale `lastModel`/`lastUsage` when a turn had no fresh events. `servedBy` is now scoped per turn and cleared at `onTurnStart`; usage only advances attribution when a fresh value actually arrives, so "unknown" stays unknown.

**Accounting.** `report.ts` dedupes cached judge usage (spend counted once per real call), subtracts judge cost, reports `netCost`, and labels the all-strong counterfactual a rate-only estimate; `modelSummary` advertises the policy-reachable tier set, not every configured model.

`harness.tiers` and `telemetry` config are now validated; 76 tests pass (was 59 after installability, 52 at the last commit), typecheck clean. Docs: this entry, handoff updated. No commit, push or deployment yet.

## [2026-09-18] research | Competitive scorecard and corrected differentiation claims

Added `docs/research/competitive-scorecard.md` and linked it from the handoff. Refetched the four closest competitors' READMEs at exact commit SHAs using GitHub read APIs. Corrected `docs/research/github-landscape.md`: loop-position-aware request routing already overlaps Sabi, rule-based routing is not a unique advantage, and sequential-routing research prevents a blanket task-only claim. Sabi's native model/effort control is a credible focus; no completed-task cost/quality advantage or unique category was demonstrated.

Compared the five-part positioning with inspected source: native routing and proxy aliases exist; broader trajectory logic is partial/in progress; learned outcome profiles and live quota scheduling were not found. Local and remote main HEAD were both `575c34cb5744a291b2c72595cfa187e90c457155`; the working tree contained additional uncommitted research and implementation work, not delivered through GitHub. Prior live-smoke claims remain attributed to the implementation handoff.

Validation: pinned README contents and references checked; local Markdown links and whitespace checked. No competitor code cloned/run, benchmarks reproduced, tests/builds or paid evaluation calls performed. Docs only; no source/config changes, issue posts, commits, pushes or deployments by this review.

## [2026-09-18] research | Router source learnings and small Sabi mechanisms

Added `docs/research/router-learnings.md` and linked it from the handoff and competitive scorecard. Inspected selected source and root licenses at the four existing pinned competitor commits through GitHub read APIs. Separated configured model choices, evidence gates, prompt-driven delegation, finite fallback plans, outcome-memory selection and offline oracle labels. Recorded pitfalls: blanket 4xx fallback, hardcoded confidence, missing-test scores, unknown cost treated as zero, and token-efficiency metrics presented without dollar accounting.

Recommended small mechanisms inside the existing pure planner and thin adapters, not another router framework or task-execution loop. Deferred copied presets/weights, automatic exploration and training. Acceptance fixtures are proposed only; the prior implementation handoff remains the starting point for checking what Sabi already has.

Validation: parent checked source spans for the core findings; local links, source-reference ranges and whitespace checked. No upstream code execution, installs, live inference, benchmark runs, project tests/builds, source/config changes, issue posts, commits, pushes or deployments by this review. The working branch is checked separately; no claim that earlier work remains uncommitted.

## [2026-09-18] change | Offline evals + retry-vs-escalation (transport) from router learnings

Acted on the competitive scorecard's "Next evidence, not more features" and the router learnings' "choose one remaining invariant, add one synthetic failing fixture, change the existing pure planner."

**Offline eval harness** (`packages/evals`, no new runtime deps, no paid calls): replays a frozen task set through the deterministic router at tool-result boundaries, comparing Sabi's routed cost against a fixed eligible baseline tier. Reports task pass/fail/blocked, routing by rule and tier, cost/savings, and two quality gates — passed tasks never above baseline, failed tasks escalated to strong. `npm run eval`.

First honest finding: on the current task set the deterministic policy over-escalates the expected-failure task to strong (no Jev in the replay), so Sabi costs ~4x the all-mid baseline (−283% offline repricing). That is the measured reason Jev exists in the live proxy and the next fixed-policy comparison step.

**Retry-vs-escalation (router-learnings #7 + "a 429 is not classified as a reasoning failure").** Added `transport` as a distinct `FailureLevel` with `rate-limited`/`quota-exceeded`/`timeout` evidence codes. `state.ts` detects transport signals before soft patterns; `trajectoryFromRound` downgrades a tool-reported error to `transport` when the text is purely transport; `policy.ts` gains a `transport` rule (default `mid`) that retries on the same tier instead of escalating to strong; the server records upstream 429/5xx as `outcome: 'transport'` with the status; `report.ts` counts transports separately from task errors. The mod's `isError` path routes a rate-limited tool result to the transport tier (`mid`), never `strong`.

90 tests pass (was 83; +7 from evals and transport), typecheck clean. Not yet committed or pushed.

## [2026-09-18] implementation | Multi-harness checkpoint 1 (in progress)

User approved all implementation phases and requested incremental pushes plus a PR to main. Restored the approved plan/evidence files, which were absent from the checkout at start. Baseline: 90 tests passed, typecheck passed, offline eval passed. Added an opt-in, isolated real-client smoke runner using only Sabi plus a synthetic localhost provider; it is a diagnostic runner, not a compatibility certification. First OpenCode probe did not complete the tool round; investigation continues. Native Prime/Hermes and shared compatibility/proxy work are in progress separately. No paid calls; OPENROUTER_API_KEY is absent and live spending budget is unresolved. This checkpoint is not a support release.

## [2026-09-18] implementation | Multi-harness checkpoint 2: shared contract

Added opt-in strict request/model compatibility, post-judge revalidation, exact host tool-name classification, explicit hashed attribution and unknown-session isolation, bounded proxy cancellation/deadlines, validated SSE/JSON responses, one-attempt transport and redirect rejection. Missing usage/pricing now stays unknown through reporting and offline evals. Existing native Command Code policy/loop remains unchanged; legacy proxy mode remains explicit.

Combined local checks passed 155 tests, typecheck and offline eval before the final checkpoint review. Real OpenCode 1.18.30 and isolated Kilo CLI 7.7.4 each completed a read-only two-round task through Sabi and a synthetic provider, routing mid→cheap. Prime's isolated strict proxy probe also passed three rounds; its native setters failed the same-parent-round gate, so no native adapter is claimed. Hermes work is tracked separately. No paid inference or normal client configuration changes. PR #3 targets main; merge waits for review and the final staged validation.

## [2026-09-18] implementation | Prime probe checkpoint and delivery handoff

Added a private, zero-runtime-dependency Prime probe package, a synthetic isolated provider profile and repeatable transport/native-timing/proxy checks. Real Prime 0.9.5 through strict Sabi and a local mock passed three rounds, including parallel/fragmented tools and usage. Native setter timing failed for continuing tool rounds and passed only on the next user prompt, so native routing is explicitly deferred. Parent ran 4 profile tests and 12 Hermes plugin tests; shared last combined check passed 155 Node tests/typecheck/eval. Updated handoff with PR #3, remaining gates and missing paid-test key/budget. Root lockfile adds only the private workspace; Python runtime caches are ignored. No live inference or normal profile changes.

## [2026-09-18] review-fix | Effective envelope and proxy accounting gate

Cleared the bounded peer-review findings before merge. Core now has one pure effective request-envelope builder shared by compatibility validation and upstream dispatch: alias/pin checks remain on the caller body, while strict parameters and context accounting include the selected upstream model and generated `stream_options.include_usage`. SSE streams require indexed choices to reach a recognized terminal finish reason before `[DONE]`, while post-terminal usage-only chunks remain valid. Unknown observed upstream models no longer inherit requested-model prices; `/models` includes the implicit cheap fallback and configured Jev targets; missing/malformed Jev usage remains unknown. Added regressions for all findings. Combined local checks then passed 164 Node tests, typecheck and offline eval; Hermes 12 Python tests and Prime 4 profile tests remain passing. Hermes → Sabi → mock passed in an isolated namespace (`mid → cheap → mid`). No paid inference or deployment.

## [2026-09-18] review-fix-follow-up | Reject post-terminal SSE deltas

After PR #3 merged as `7d57ff4`, a final read-only peer probe found one additional Important stream-integrity edge: a choice that already emitted a terminal finish reason could receive later deltas and still pass `[DONE]`. The follow-up rejects any later event for a finished choice and adds a regression. Focused SSE tests and typecheck pass; the full Node/eval follow-up is running before PR #4. No other Critical/Important findings remain.

## [2026-09-18] change | Media is a routing constraint (images on text-only tiers)

Diagnosed from the proxy's own decision log: 8 of 12 recorded errors were `No endpoints found that support image input` (OpenRouter 404, `failed_routing_step: Filter by Image Support`), every one routed to cheap → `deepseek/deepseek-v4-flash-0731`. The router had no notion of input modality, and `ensureRouteCompatible` could not catch it because no capabilities were declared (undeclared = unknown = permitted), so an image round failed at the upstream. The mod path was quieter and worse: the host strips images for a text-only model, so the round answered blind with no error at all.

`TrajectoryState` now carries `inputModalities` and `mediaCounts`, extracted by `tallyMedia` from content parts — including nested tool-result content, where a tool returns a screenshot — and `servesInputModalities`/`firstServingTier` (compatibility.ts) let tier selection treat modality as a hard constraint: `route()` and `planRound()` serve the round from the first tier, in configuration order, whose declared modalities cover it, recording `rule: capability`. A fixed alias refuses instead (`400 incompatible route 'cheap': input modality 'image' is not supported`) because it is an explicit choice; with no capable tier the proxy refuses and the mod leaves the round on the session model. Images are charged 1500 tokens each in the context estimate — the host's own per-image bound, verified in the shipped bundle, rather than the base64 length, which produced ~111k phantom tokens for a 400 KB payload in a measured test.

Config: `models[].capabilities.inputModalities` (verified per id from the OpenRouter API: flash-0731 text-only, luna and sonnet-5 text+image+file) and `harness.tiers[].inputModalities` (verified from the CLI's own registry: deepseek-v4-flash and GLM-5.3 text-only, gpt-5.6-luna text+image). The mod detects media by mirroring the host's predicate (`content.some(part => part.type === 'image')`), widened to every role and to nested content, reporting positive evidence only.

Live verification against the real upstream: an exploration round carrying an image, which the policy planned for the text-only cheap tier, was served by `openai/gpt-5.6-luna` with `rule: capability` and returned 200 (previously a hard 404), while the same request on the fixed `sabi-cheap` alias returned the explicit 400. 175 Node tests pass (10 new), typecheck clean.

## [2026-09-18] review-fix | Verify proxy attribution against the two review findings

Cleared the two P2 findings raised against the attribution branch before merging it. Both are already satisfied by the stricter contract that landed on `main` — `x-sabi-client`/`session`/`turn` validated against an opaque charset, session and turn identities hashed (`hashIdentity`), a `randomUUID()` request id echoed as `x-sabi-request-id`, and configured `x-sabi-*` upstream headers stripped case-insensitively — so the branch's own mechanism was dropped rather than merged: recording client-supplied `x-request-id`/`x-session-id` verbatim would have re-introduced exactly the persistence path the review objected to, for identity values main had already replaced.

What the merge adds is the regression coverage the findings showed was missing: client-supplied identity headers are ignored and never persisted or forwarded; an accepted session identity is persisted only as `hashIdentity('session', client, session)`; a non-opaque identity header is refused with 400 before any record is written; and configured upstream headers in normal HTTP casing (`X-Sabi-Session-Id`, `X-Sabi-Request-Id`) are stripped while ordinary vendor headers (`x-title`) pass through. 169 Node tests (4 new), typecheck clean. No live inference.

## [2026-09-18] review-fix | Portuguese mirrors and two overstated guarantees

PR #1 merged before its review findings were cleared, so the three P1s land here — each verified against the code, not only against the English text. Jev is proxy-only (`server.ts` is the only caller of `judgeTriggers`/`applyJudge`; the mod never imports the judge), and the PT-BR README said otherwise where it implied both classes consult it. The 6k-character judge state is a target, not a bound: `buildJudgeState` shrinks only the tool-result excerpt and stops at 200 characters, leaving the instruction, up to 40 tool names and the round metadata untouched — the PT-BR README and *both* install guides now say so, since the English one carried the same claim. And the decision log is metadata-only **with one exception**: a failed upstream call persists `sanitizeError(text)` — the first 200 characters of the provider's error response, credential patterns redacted — so a provider that echoes request content in its error line puts that line in the log.

Also closed the mirror's drift against the current English source: the missing "Mídia e visão" and "Imagens e outros tipos de mídia" sections, the telemetry privacy statement, the two media troubleshooting rows, the Hermes/Prime adapter lines and the three research links. Heading parity, link targets and in-document anchors are checked mechanically. Docs only: no runtime code, no tests, no behavior change.

## [2026-09-18] change | RTK learnings: a discover view and wrapper-aware classification

Bounded review of `rtk-ai/rtk` at pinned `6d104308c56c0a51250f8a200e5056787128fb65` (README plus the savings page; nothing cloned, installed or run) — [docs/research/rtk-learnings.md](docs/research/rtk-learnings.md). It is a different axis: RTK compresses bash output bytes, Sabi schedules models. The note is explicit about what does *not* transfer — output compression would mean rewriting what the model sees, which the class-A mod deliberately never does.

Two things did transfer. `npm run report` gained a `discover` block derived only from recorded decisions: judge vetoes with the cost they avoided at the same usage, judge upgrades, `unclassified` share, policy rules that never fired, and configured tiers that never served — in text and `--json`. On this machine's 534-round log it reports 9 vetoes worth **$0.7449** avoided (rate-only), 4 upgrades, 16 unclassified rounds (3.0%) and three rules that have never fired (`stuck`, `context-pressure`, `transport`), which the previous aggregation hid. And classification now sees through RTK's rewrite prefix: `unwrapRtk()` strips `rtk` plus one wrapper verb (`err`/`test`/`proxy`/`summary`) and maps RTK's own read verbs to exploration, so `rtk cargo test` stays verification and `rtk read` stays a read instead of falling to `unclassified` — which the proxy consults the judge on. RTK supports Hermes, which Sabi already adapts, so the two can meet in a real session.

Their savings page is the model for claim discipline — measure bash bytes, label the estimator (`bytes / 4`, no tokenizer), name the dilution chain next to the number — recorded for the next counterfactual revision rather than applied. 182 Node tests (3 new), typecheck clean, report smoke-tested against the real log. No upstream benchmark reproduced, no paid inference.

## [2026-09-18] change | A clean start for OpenCode, and provider errors that explain themselves

The install guide stopped at Command Code, so an OpenCode or Hermes user had no from-scratch path: the recipes lived in `docs/harnesses.md` (a compatibility document) and a Hermes adapter README written for isolated probes. `docs/install.md` and its PT-BR mirror now carry a "Clients other than Command Code" section — what class-B clients get and do not get (model routing, no effort axis, failure inferred from text, Jev included), the OpenCode path, the Hermes recipe with its capability caveat, and what a missing judge key does (verified: HTTP 200, `judge.status: error`, ~0.6 s lost per judged round, fail-open).

`npm run connect:opencode` writes and preserves the OpenCode provider: it merges `provider.sabi` only, backs the file up once, refuses invalid JSON, and leaves the default model alone unless `--set-default`. Verified against OpenCode 1.18.30 with a real profile and the real proxy — the generated config completed a read tool round and was attributed `client: opencode`. Writing it surfaced a requirement no doc knew: OpenCode rejects a model entry with `limit.context` and no `limit.output`, so tiers without a declared `maxOutputTokens` get a conservative 4,096-token client cap, printed rather than silent. Those runs also showed this account's OpenRouter credit is nearly exhausted, which is what the later 402s were.

That 402 was undiagnosable: OpenRouter reports credit and context failures *inside an HTTP 200 stream*, and the tap treated any `error` event as a protocol violation, so the decision recorded `upstream response failed` and the client retried twelve times. The tap now raises `UpstreamStreamError` carrying the provider's own message, and the server persists it (sanitized, first line, ≤200 chars) while the client-facing text stays generic. `minContextWindowFor`/`minOutputTokensFor` moved into core so both client writers derive limits identically.

189 Node tests (7 new) pass on three consecutive runs, typecheck clean. Docs otherwise: README/PT-BR pointers and the `docs/harnesses.md` OpenCode row updated with the real-profile evidence. No paid inference beyond the two verification rounds; Hermes stays recipe-only — no stable binary on this host.

## [2026-09-18] change | Consent gate for the proxy path (per-upstream kill switch, paid/free question)

Triggered by an incident: Command Code was pointed at Sabi's proxy (`sabi/sabi-code`), which registered every paid-backed alias in `~/.commandcode/providers.json` unconditionally and spent real OpenRouter credit with no consent step and no runtime way to turn it off.

`UpstreamEntry` gains `enabled?: boolean` (omitted/`true` = usable), validated in `config.ts`. Enforced at every dispatch path: `ensureRouteCompatible` (`packages/core/src/compatibility.ts`) refuses to dispatch to a disabled upstream — the one choke point every route (fixed, adaptive, post-judge revalidation) passes through — and `connect.ts` will not register any Command Code alias whose only reachable tiers sit behind one, reusing core's existing `tiersFor` (shared with the OpenCode writer) rather than a second tier-resolution path. `connect.ts` also gained an explicit paid/free question before registering anything paid: `--paid`/`--free` decide it outright; otherwise it prompts on a real TTY and defaults to **free** when non-interactive, so it never blocks a CI/agent-driven run on stdin. The kill switch overrides consent — `--paid` cannot re-enable a disabled upstream.

**Availability-aware fallback, found on re-review.** The router's fallback (added earlier this session to reroute around a disabled upstream instead of hard-failing, reusing the same mechanism as the existing modality fallback) only covered the *initial* routing decision. `judge.ts`'s `retier()` — both the veto fallback and the difficulty override — could still hand back a tier behind a disabled upstream or one that cannot serve the round's modality, which would then hard-fail at `server.ts`'s post-judge `ensureRouteCompatible` revalidation, defeating the whole point of the earlier fallback for any judged round. `retier()` now runs the same `isEnabledUpstream` + `servesInputModalities` check and falls back to the first serving tier, recording `rule: 'availability'`, before committing the judge's verdict.

Behavior change, documented in both install guides: a non-interactive `connect:command-code` run now registers nothing paid by default; `--paid` reproduces the old unconditional behavior. `sabi.config.json`'s shipped `openrouter` upstream stays enabled by default — disabling it would silently break the documented Path B walkthrough and `npm run eval`'s dependency on the real config, for no gain over the actual fix.

206 Node tests pass, typecheck clean, offline eval unaffected. New coverage: `connect.test.ts` (unit tests for the pure decision functions plus spawned-subprocess integration tests against temp configs), one `config.test.ts` case for `enabled` schema validation, one `compatibility.test.ts` case for the dispatch guard (strict and legacy mode), and two `judge.test.ts` cases for the veto/difficulty availability fallback. Docs: `docs/install.md` + `docs/install.pt-BR.md` (Configuration/Security/Point-Command-Code-at-it sections), `docs/decisions.md`. Deferred, not built: Hermes/OpenCode/Kilo consent branches and a self-service "add a model" flow (needs a live-endpoint fetch, never hand-typed pricing/context, per the no-invented-facts rule).

## [2026-09-18] docs | Correct stale "private repo" claims — the repo is public

`AGENTS.md`, `docs/context.md`, `README.md`/`README.pt-BR.md` and `docs/install.md`/`docs/install.pt-BR.md` all said `vizuh/sabi` was private. Verified via `gh repo view`: `"isPrivate": false`. Corrected all five. This removes one premise of the existing distribution decision (npm publishing needing a public repo, which was cited as unavailable) — recorded as a new dated entry in `docs/decisions.md` rather than rewriting the original entry's historical reasoning. Decision: still not building the daemon/auto-updater/hosted-routing-registry stack proposed this session — no external user to serve yet; visibility and need are different facts. `docs/decisions.md`'s historical entries (which said "private" when that was true) are left as-is, append-only. Docs only, no code changes.

## [2026-09-18] change | Compaction awareness: measured context, boundary invalidation, a shadow judge question

Closed the four gaps a review of [picaye/jev-compaction](https://github.com/picaye/jev-compaction) exposed against Sabi's context handling. That project's README was read at its published state; nothing was cloned, built or run, and no Jev/TypeSafe call was made — every claim below is local test evidence, and the shadow question is explicitly unverified.

- **Measured context, not an estimate.** `state.contextTokens` is now the provider's billed total for the previous round of the same session, floored at the character estimate, with `contextKnown` set only then. The proxy keeps bounded per-session memory (identified sessions only, 512 entries) filled from tapped usage; the mod fills its ledger from the host's `usage`. The proxy estimate also counts tool-schema bytes, which it previously ignored, so `context-pressure` can finally fire on real numbers instead of never.
- **A host rewrite invalidates stale state.** A request (proxy) or transcript (mod) that comes back below half its previous message count is a compaction: `contextGeneration` advances — it reaches the judge request state, so the judge cache key cannot serve a pre-rewrite verdict after it — and the repeated-failure streak restarts, so the first failure after a rewrite is one fresh failure instead of `stuck`. The host still owns compaction; Sabi rewrites nothing.
- **A third Jev question rides the existing batched call, in shadow mode.** `evidence_redundant` is read leniently (a missing or malformed shadow answer never fails the applied judgment), recorded as `judge.evidenceRedundant`, and counted by `npm run report` (`shadow` line, `judge.evidenceRedundant` in `--json`). No route, threshold or transcript consumes it.
- **Offline eval fixture.** `EvalTask.compactedAfterRound` and a `compaction-reset` task exercise the boundary in the replay: identical second failure, `rule: failure`, `failureStreak: 1`, `contextGeneration: 1`.

220 package tests (12 new), typecheck clean, `npm run eval` 8 tasks / 10 rounds. Not done: no live session has compacted yet, so the detector's thresholds (`COMPACTION_MIN_MESSAGES`, `COMPACTION_SHRINK`) are unmeasured heuristics; the mod still has no judge path, so shadow answers can only come from the proxy.

## [2026-09-18] fix | Provider and subscription limits are transport, not task failures

A real session hit a plan wall — `You've hit your session limit · resets 8:30pm`, `Usage limit reached · continuing automatically at 8:30pm`, `uses your weekly limit`, `error type rate_limit` — and the detector's answer, measured with those exact strings before the change, was the wrong kind of nothing or the wrong kind of escalation:

| Before | Text |
|---|---|
| `none` (no evidence at all) | `You've hit your session limit · resets 8:30pm` |
| `none` | `Usage limit reached · continuing automatically at 8:30pm` |
| `none` | `uses your weekly limit` |
| `hard` — escalate to strong | `Error: You've hit your session limit` |
| `hard` | `Error: rate_limit_error` (the pattern required `rate-limit`, not `rate_limit`) |
| `hard` — must stay hard | `Tests: 1 failed, 0 passed\nexpected 200, got 429\nexit code: 1` |
| `transport` — must stay transport | `HTTP 429 too many requests: rate limit exceeded` |

Two routing failures followed. A round whose only evidence was a limit message fell to `unclassified` — the rule the proxy consults Jev on — so Jev was asked "how demanding is this step?" about a plan wall and could escalate; and a limit message that looked like an error line became `hard`, escalating to the strongest tier, which hits the same wall and spends more doing it.

`TRANSPORT_LIMIT_PATTERNS` (rate limit / too many requests / session, usage, weekly, monthly, daily, subscription or plan limit / quota exceeded) is now checked before the hard patterns, so wording beats an `Error:` prefix in the same text. The numeric signals stay where they were (`429`, `timeout`): a failing test that prints a 429, or a test that timed out, is still a task failure and never loses to a status code. After the change every limit phrasing above classifies `transport` (evidence `quota-exceeded` / `rate-limited`), the round routes to the transport tier — retry, never escalate — and Jev is not consulted for it at all.

Jev gets the same knowledge for paraphrases that still reach it: `real_problem.criteria.false` now names a provider or subscription limit, and the difficulty instructions say a limit is never task difficulty. Both are prompt text, not measured behavior — unverified until real limit traffic passes through them.

222 package tests (2 new; 236 with this checkout's uncommitted setup-wizard tests), typecheck clean, `npm run eval` unchanged (8 tasks / 10 rounds). Docs: README/PT-BR policy paragraph. No new evidence codes, no config keys.

## [2026-09-18] change | `npm run setup` — unified harness wizard

One command instead of three separate manual procedures: `scripts/setup.ts` asks which harness (Command Code / OpenCode / Hermes), then whether to enable Jev, then wires up the right thing — Command Code Class A prints `cmd mods add ...` (no writes), Class B and OpenCode spawn the real, already-tested `connect.ts` writers, Hermes creates `HERMES_HOME` and copies the plugin (new, uncertified — matches `docs/harnesses.md`'s own stance). Kilo/Prime Agent point at the manual recipes, unautomated.

Two-pass review caught real bugs before merge, both about Jev specifically. First: declining Jev (`--no-jev`) was a no-op against the shipped config, which already ships `judge.enabled: true` — `enableJev()` only ever set it to `true`, never `false`, so answering "no" silently left Jev on. Fixed: `setJevEnabled(path, enabled)` always writes the resolved answer, and the Jev question is skipped entirely for Command Code Class A (Jev is proxy-only; asking would contradict Class A's own "nothing written" message). Second: enabling Jev on a config whose `judge` block lacked `apiKey` left it `undefined` — `TYPESAFE_API_KEY` was never wired to anything, so a judge call would go out unauthenticated. Fixed: defaults `judge.apiKey` to `"$TYPESAFE_API_KEY"` when absent, same as `baseURL`'s existing "set only if absent" pattern; the literal key value is never read, printed, or written, matching the two adapter writers' `"$ENV_VAR"`-only convention. Also fixed: spawned writers' exit codes weren't propagated (a failing `connect.ts` looked like success to a caller chaining `npm run setup && ...`); an unrecognized `--harness=` value fell through to the "no flag" path instead of failing loudly; Hermes's `loadConfig()` ran *after* creating files, so a missing config crashed mid-setup instead of failing clean; the "this file is git-tracked" note printed unconditionally even for a config outside any repo. Extracted the timeout-safe prompt helper (`promptWithTimeout`) into `packages/core` — it existed almost verbatim in `command-code/connect.ts` already, and would have been a third copy once Hermes/OpenCode grew their own prompts.

Caught during review-fix and fixed immediately, not shipped: a live collision with another concurrent session on this shared checkout switched `HEAD` mid-session (to `fix/limit-transport-classification`, already merged as PR #12); an early version of this same fix's own test suite pointed `SABI_CONFIG` at the real tracked `sabi.config.json` for the OpenCode/Hermes cases, and running it against the *always-writes-now* Jev patch flipped the shipped `judge.enabled` to `false` on disk. Caught via `git status`/`git diff` before commit; `sabi.config.json` restored via `git checkout --`, tests rewritten to use a temp copy of the shipped config in every case, never the tracked file. `npm run setup` verified manually end-to-end for all three harnesses plus the Jev patch, in addition to the automated suite.

243 Node tests pass (21 new: `scripts/test/setup.test.ts`), typecheck clean, offline eval unaffected. Docs: `docs/install.md`/`install.pt-BR.md` (new "Quick setup" section, explicit that Hermes automation is uncertified — not equivalent to Command Code/OpenCode's certified writers), `README.md`/`README.pt-BR.md` one-line pointer.
## [2026-09-18] release | The mod is publishable to npm as @vizuh/sabi

Trigger: Hugo asked for the mod to reach other machines/users without a clone — the recorded condition for revisiting the deferral in `docs/decisions.md`.

Packaging: `packages/adapters/command-code/pack.mjs` (esbuild, a devDependency) bundles `mod/sabi.ts` plus its `@sabi/core` imports into one self-contained `mod/sabi.mjs`, copies the repository's default `sabi.config.json` beside it, and writes a publish manifest with no dev-only fields into the gitignored `pkg/`. The repository source is untouched, so a clone keeps loading `mod/sabi.ts` in place and stays auto-updating on `git pull`; only the npm artifact is bundled. `.github/workflows/release.yml` runs typecheck + tests on a `v*` tag, builds, and publishes with provenance. Nothing is published yet: that needs the `@vizuh` npm scope and an `NPM_TOKEN` repository secret, then `git tag v0.1.0 && git push origin v0.1.0`.

Verified without publishing. `npm pack` produces exactly four files (`package.json`, `mod/sabi.mjs`, `sabi.config.json`, `README.md`), the bundle imports standalone, and extracted into a neutral directory with no project or user config, `cmd -p "Read package.json…" --mod …/mod/sabi.mjs --model gpt-5.6-luna` exited 0 with turn 2 planned on the shipped `cheap` tier (`deepseek/deepseek-v4-flash`, rule `exploration`, measured `contextTokens` = turn 1's billed total). A control run with the shipped config's `cheap` id altered to `zai-org/glm-5.3` planned exactly that value — proof the bundle loaded through the real mod loader and read its own shipped config rather than the repository's.

**Open defect that control run exposed:** when the *mod* plans `zai-org/glm-5.3` (the shipped `strong` tier), the round fails with `403 Model/provider not recognized: anthropic:zai-org/glm-5.3`. Both `zai-org/GLM-5.3` and `zai-org/glm-5.3` succeed as a session model (`--model`), so the id exists — provider resolution for a mod-supplied id is what fails. Not reproducible interactively from here (print mode refuses shell/file tools, so no failure round can be induced headlessly). The shipped `strong` tier is therefore effectively unusable on the Go plan until a verified id is found; documented in the README's plan coverage and `docs/handoff.md`. Pre-existing on `main`, not introduced by this change, and deliberately not papered over with a guess.

Docs: README/PT-BR (npm install block, plan-coverage known issue), `docs/install.md`/PT-BR (npm alternative, updating), `docs/decisions.md`, `docs/handoff.md`. No LICENSE file exists, so the published manifest declares no license — flagged rather than invented.

## [2026-09-18] release | Release pipeline: npm scope, token, MIT, tag-driven publish with provenance

The distribution side is organized end to end. `@vizuh` exists as an npm scope (owner `atroci`), the `NPM_TOKEN` repository secret is set from the workspace secrets file (value never printed; used only through a session-scoped npmrc, then deleted), and `packages/adapters/command-code/package.json` moves to 0.1.1 with an MIT `license`. A root `LICENSE` (MIT, "Copyright (c) 2026 Vizuh") now ships in the tarball; `pack.mjs` copies it and carries `license` into the published manifest; and `release.yml` also creates a GitHub Release with generated notes and the packed tarball. A release is now one command: `git tag vX.Y.Z && git push origin vX.Y.Z` → typecheck + 243 tests + build + `npm publish --provenance` + Release.

`@vizuh/sabi@0.1.0` was published manually first, to claim the name (no provenance attestation). Both registry and artifact were verified: packument, dist-tags and visibility resolve, the tarball downloads from the registry, and the published `mod/sabi.mjs` routed a real two-turn run in a neutral directory — turn 1 `gpt-5.6-luna` → turn 2 planned `cheap`/`exploration` on `deepseek/deepseek-v4-flash`, measured `contextTokens`, exit 0. `0.1.1` is the first CI release, so provenance starts there.

Operational note, corrected after the first CI run: npm answers a publish with "Your package is being processed and may take a few minutes to become available" — until that finishes the version document 404s and `dist-tags` still reports the previous version, while the package's other endpoints resolve. The first publish's roughly eight-minute window was this, not a client or edge cache: the query-string cache buster that changed nothing was the tell. (An earlier draft of this entry blamed a probe-poisoned cache — wrong.)

That first CI run also exposed a workflow bug, after a successful and provenance-signed publish: `npm pack --pack-destination dist` fails when `dist/` does not exist, so the GitHub Release step exited 254 while `Publish @vizuh/sabi` had already succeeded (`+ @vizuh/sabi@0.1.1`, sigstore `logIndex=2888077857`, 5 files). Fixed with `mkdir -p dist`; the `v0.1.1` Release was then created manually with the published tarball. Publish is ordered before the Release step precisely so this class of failure never costs a release.

## [2026-09-18] release | Tags, Releases and languages aligned; the repo connected to the npm package

The surfaces now agree with each other. On GitHub: `v0.1.0` is tagged at `80a6ddb` — the manual name-claim publish — and `v0.1.1` at its merge commit; each has a Release carrying the exact tarball npm serves. The repository's own metadata is set (`gh repo edit`): description, homepage pointing at the npm package, and topics. `release.yml` learned to check the registry first: a version that is already published is **skipped** rather than failing, and its Release is created from the registry's tarball instead of a fresh rebuild — so backfilled or re-pushed tags are idempotent, and a publish is never attempted twice. Release creation itself is idempotent too.

A third language mirror joins the READMEs: `README.zh-CN.md` (Simplified Chinese), linked from the English and PT-BR language lines and carrying the same headings, commands, ids, tables and warnings — translated only, nothing added or dropped. The install guide stays EN/PT-BR for now.

Recorded for the next reader: the backfilled `v0.1.0` tag produced one red run. Its push resolved the workflow from `main` — the tag's own commit predates the workflow — at a moment when `main` still carried the pre-guard definition, so the run attempted a publish and hit npm's `403 You cannot publish over the previously published version`; a playbook re-run replays that same definition, so it stayed red. Nothing in the artifact needs fixing: the tag, the Release and the registry were already correct, and the guard that would have skipped it has been on `main` since #18. The guard itself (#19 also stands the build down for a tag cut before the packaging existed) has not yet run on a live tag — the next release exercises it.

## [2026-09-18] change | Local recovery-rate tie-breaker for Jev's ambiguous branch

Checked first: no task/round success signal exists anywhere in this codebase — `DecisionRecord.outcome` is transport-level only, and `packages/evals`'s pass/fail is a hand-typed fixture label with no connection to real logs. A third-party benchmark table pasted into this session (as a basis for scoring 71 models) was rejected outright — unverifiable, and this repo verifies model facts against live sources or labels them unverified.

`packages/core/src/recovery.ts` (new): a per-`(tier, upstreamModel)` recovery rate computed entirely from data already logged — a round with `state.failure === 'hard'` credited with a recovery if the next round in the same session comes back `failure: 'none'` (excluded, not counted either way: pairs straddling a host compaction, a `'transport'` successor, a censored trailing round, an unknown-session row, or a pair where either side isn't `outcome: 'ok'`). Gated on a one-sided 95% Wilson interval and `n ≥ 30`; below that, `recoveryRate()` returns `undefined`. `applyJudge()` takes this as an optional 4th `profile` parameter (omitted ⇒ identical to today) and consults it in exactly one place — the `failure` rule's ambiguous branch, declining the escalation only when the fallback's worst-credible rate (`wilsonLower`) beats the incumbent's best-credible rate (`wilsonUpper`), via one shared `candidateBeatsIncumbent()` predicate reused by `judge.ts` and `backtest.ts`. Can only fall back to a tier `decideTier()` itself already proposed; never fires in the veto/confirm/difficulty branches. `packages/server/src/server.ts` loads the profile once at server startup, before any request.

**Second-pass review found the trigger was structurally dead** (`state.failureStreak` is hardcoded `0` everywhere on the proxy path — only the Class A mod computes a real streak, and the mod never calls Jev), plus four more real bugs: pairing pre-filtered to `outcome:'ok'` before checking adjacency (silently collapsed an intervening error/aborted round, letting non-consecutive rounds pair); the fallback's `retier()` could resolve `next.rule` to `'unclassified'`, re-triggering the difficulty block and overwriting the decline; `retier()`'s own availability fallback could in principle escalate stronger than the incumbent while still being labeled "declined"; the comparison (`candidate.wilsonLower > incumbent.pHat`) never discounted the incumbent's own sampling noise. All fixed — see `docs/decisions.md`'s dated entry for the full list, including two more (server.ts conflating a profile-load failure with a judge outage inside the same `try`, and `backtest.ts` reconstructing a `tier::model` key by splitting a string instead of decoding it, both fixed).

`packages/evals/src/backtest.ts` (new, `npm run backtest`): reads the real `.sabi/decisions.jsonl`, reports per-tier recovery rates (or "insufficient data") and a counterfactual — how many historical ambiguous rounds the new rule would have declined. Run against this machine's real 550-row log after the fixes: zero eligible pairs at all (this traffic has no session-tracked hard-failure adjacency — a real fact about this data), 8 real ambiguous rounds found, 0 declined. A measurement tool, not a pass/fail gate; the mechanics themselves are proven by 11 synthetic unit tests in `recovery.test.ts`.

`packages/core/src/log.ts` gained `readDecisions()`, factored out of `report.ts`'s inline parse loop so `report.ts`, `backtest.ts` and `recovery.ts` share one read path instead of three.

259 Node tests pass (17 new here: `recovery.test.ts` — pairing/exclusion rules including the adjacency-breaking regression, non-overlapping-interval comparison, and key-decoding without string-splitting, with the Wilson bounds checked against hand-computed values for known (p̂, n) pairs; 6 new `judge.test.ts` cases proving the tie-breaker declines when decisive, is a no-op below the sample gate, never overrides a confident veto/confirm or fires outside the ambiguous branch, and survives the fallback-rule-is-unclassified collision), typecheck clean, offline eval unaffected. Docs: `docs/decisions.md`. Explicitly out of scope: the full `U(m,t)` formula (no verified local source for `value`/`C_latency`/`C_retry`); porting to the Class A mod path (`judge.ts` is proxy-only today).

## [2026-09-19] feat | Agent Controller: new advisory-only surface (`packages/controller`)

Checked first, before designing anything: the proxy only ever sees requests from an already-running, already-chosen harness session — there is no earlier hook to wire a controller into inside the live request path, so this is a new standalone surface, not a `packages/server` change. No live "what's running" registry exists anywhere in Sabi today (`DecisionRecord.sessionId` is a post-hoc analytics grouping, not a live identity). Orca (external `orca-ide` binary) has real read-only JSON commands but a documented lifecycle-reporting bug (`context/Hugo OS/postmortems/2026-08-03-orca-br-skill-legacy-read-only.md`) — treated as best-effort, never a hard dependency.

New package `@sabi/controller`: `npm run controller -- "<request>" [--cwd=<path>] [--orchestrate] [--json]` recommends one of CONTINUE/DELEGATE/SPAWN/ORCHESTRATE/ASK via a pure, five-branch, first-match-wins rubric (`decide.ts`) over signals gathered in `signals.ts` — git cleanliness (informational only, never a gate), a 30-minute-recency stuck-session check reusing `@sabi/core`'s `readDecisions()` and the same `state.failure === 'hard'` predicate `recovery.ts` established, a best-effort Orca query (`orca.ts`, fail-open on missing binary/timeout/non-zero exit/invalid JSON/wrong shape, never throws), and an explicit `--orchestrate` flag or five-phrase keyword allowlist for multi-scope detection. V1 is shadow-mode only: every call is logged to `.sabi/controller-decisions.jsonl`; the CLI never executes DELEGATE/SPAWN/ORCHESTRATE itself.

Two real judgment calls, both named explicitly in `docs/decisions.md` rather than picked silently: the stuck-session gate uses recency, not `sessionKnown === true` like `recovery.ts`, because the recovery tie-breaker's own real backtest found zero `sessionKnown: true` rows on this machine — gating the same way here would make SPAWN permanently dead. And a real `orca-ide` install on this machine responded during manual smoke-testing, but its JSON is not a bare array — `runOrca()` correctly reports `unrecognized-shape` rather than guessing a field name, so `matchingWorktree`/`matchingTerminal` stay hardcoded `false` (DELEGATE never false-positives, but also never fires) until the real shape is confirmed.

33 new tests (`decide.test.ts`, `signals.test.ts` — real `git init` + hand-built `.sabi/decisions.jsonl` fixtures — `orca.test.ts` — five chmod'd executable fixture scripts, one per failure mode — and `cli.test.ts`, spawning the real CLI end to end), 292 Node tests total, typecheck clean. Manual smoke test against this machine's real environment confirmed the shape-mismatch finding above. Docs: `docs/decisions.md`, `docs/handoff.md`. Explicitly out of scope: executing any recommended action; wiring into `packages/server`; a real Orca match predicate (`TODO — ask Hugo`, blocked on unverified field names).

**Same-PR follow-up, still 2026-09-19**: a Codex review flagged the Orca lifecycle-bug claim as uncited (fixed — now cites `context/Hugo OS/postmortems/2026-08-03-orca-br-skill-legacy-read-only.md`) and a real bug — `runOrca()` hardcoded parsed output under `worktrees` regardless of which subcommand ran, so `queryOrcaTerminals()` would have silently populated the wrong field (fixed with an explicit `field` param, tested). Separately, a live (read-only) query against this machine's real `orca-ide` 1.4.201 install revealed the actual envelope shape — `{ id, ok, result: { worktrees/terminals: [...] } }`, not a bare array — closing the `TODO — ask Hugo` above. `runOrca()` now parses that real shape and `matchingWorktree`/`matchingTerminal` do a real path-only comparison (not branch-aware: real entries observed with `branch: ""`). Verified end to end: `npm run controller -- "..." --cwd=<a path orca already has a worktree open on>` now returns `DELEGATE` for real, the first time this action has fired outside a synthetic fixture. 6 new tests since the field-bug fix (2 in `orca.test.ts` from that fix, 2 more regression tests for the envelope shape, 2 in `signals.test.ts` for real path matching), 298 Node tests total, typecheck clean.

**Dogfood pass, still 2026-09-19**: ran six real scenarios through the actual CLI against real state (a hard-failure log row on disk, a real orca-ide worktree match, real keyword/flag triggers, real orca failure modes) instead of only reading the code, plus an independent reviewer agent (fresh, no shared context with the implementation) against the diff. It reproduced a real crash: `stuckSessionSignal()` (`signals.ts:48`) read `last.state.failure` unguarded — a log row that parses as valid JSON but lacks a `state` object (a partially-written row from a crashed writer, or a hand-edited one) threw `TypeError: Cannot read properties of undefined (reading 'failure')`, uncaught all the way to `main()`, non-zero exit, and — because the crash happened before `appendControllerDecision()` — **nothing was logged**, the one thing this advisory tool must never fail to do. Every other signal source here (`orca.ts`, `gitClean()`) was already fail-open by design; this was the one exception. Fixed with an optional-chained, type-guarded read; degrades to "not stuck" instead of crashing. Also fixed, both non-blocking but real: the DELEGATE reason string still said "repo+branch" after the match predicate became path-only (a stale claim persisted into every logged DELEGATE row); and `cli.ts` took only the first non-flag argv token as the request, so an unquoted multi-word request (`npm run controller -- fix the login bug`, no quotes) silently truncated to `"fix"` with no warning — now joins every non-flag token. 5 new regression tests (2 for the crash — missing `state`, `state: null` — 1 for the unquoted-request join), 301 Node tests total, typecheck clean. Independent re-verification requested.

**Independent re-verification, still 2026-09-19**: a second, separate fresh reviewer confirmed the reported crash was genuinely fixed (reproduced pre-fix, re-ran post-fix), confirmed the reason-string and unquoted-request fixes complete — but found a sibling, unfixed crash of the same species one line earlier: `stuckSessionSignal()`'s recency filter (`rows.filter((r) => new Date(r.ts)...)`, then `signals.ts:46`) read `r.ts` unguarded, so a literal top-level `null` log row (valid JSON, still an unvalidated shape) threw `TypeError: Cannot read properties of null (reading 'ts')` — same consequence, nothing logged. The prior fix patched the one property access the first review reported instead of the shared root cause: every row consumer here still assumed "parses as JSON" implies "is a usable object." Re-verified independently before fixing. Fixed properly this time — a single `isPlainRecord()` guard filters non-object rows (`null`, numbers, arrays, strings) out once, at the top of `stuckSessionSignal()`, before any property is read, plus a `typeof r.ts === 'string'` check before constructing a `Date`. Swept all the second reviewer's probed variations by hand (`null`, `42`, `[]`, `"a string"`, missing `ts`, `outcome`-only) against the live CLI — none crash. 4 more regression tests, 303 Node tests total, typecheck clean.

**Third and final independent pass, still 2026-09-19**: a third, separate fresh reviewer tried harder to break the root-caused guard — non-string/null/object/array `ts`, object/array `state.failure`, a 5000-line log with ~14% garbage rows interleaved, `__proto__`-keyed rows, non-parseable dates, and confirmed the actual acceptance criterion (the shadow log gets a correct record even on a top-level `null` row, not just "doesn't crash"). No new crash found. Two non-blocking notes, not re-opens: `isPlainRecord()`'s `Array.isArray` exclusion wasn't independently exercised by any existing test (added one, `state: []`, that actually discriminates it — confirmed by deleting the clause and watching a targeted test fail); and this package's own `readControllerDecisions()` (`log.ts`) has the identical "trusts parsed shape" gap but has zero callers anywhere in the repo today — flagged in a code comment for whoever wires up a future read path, not fixed now since there's nothing exercising it. 1 more regression test, 304 Node tests total, typecheck clean. Three independent reviewers, two real repair cycles, ready to merge.

## [2026-09-19] feat | Capacity-aware handoff planner for the Agent Controller

Added `AgentCapacity`, agent session/harness descriptors, and `HandoffSnapshot` to the controller contract. The pure `planAgentRoute()` gate removes an active session from `CONTINUE` when a quota reset or rate-limit wait costs more than handoff plus replacement execution, reconsiders it after reset, and chooses a smallest-sufficient healthy existing session before a spawn candidate. Process-dead, authentication-unavailable, repeated-failure, blocked/waiting and required-capability conditions are deterministic blockers. No Jev call, process spawn or live inventory adapter was added.

Seven focused tests cover the 39-minute quota handoff, existing-session preference, spawn fallback, reset reconsideration, short-reset wait, rate-limit threshold, lower-priority fallback ordering and hard blockers. Controller tests and typecheck pass. No commit, push, deployment or automatic handoff.

## [2026-09-19] review | Agent Controller dogfood

Exercised six controller scenarios through the real CLI with live Orca discovery and recorded every recommendation in `.sabi/dogfood-controller-decisions.jsonl`. Recommendations were `DELEGATE`, `DELEGATE`, `CONTINUE`, `ORCHESTRATE`, `CONTINUE` (controlled `binary-not-found`), and `ORCHESTRATE`; none executed. The run exposed the blocking integration gap: the CLI remains advisory and uses legacy `decide()`, so the capacity planner, handoff snapshot, target selection, dispatch/spawn/recovery, and actual-execution telemetry are not wired. `npm test` passed 311; typecheck passed.

## [2026-09-19] feat | Thin Orca bridge and OpenCode candidate

Added `packages/adapters/orca` as a minimal same-repo plugin bridge: manifest, `sabi.dispatch` command, and bounded worktree/agent-status event subscriptions. Routing and execution remain in the controller/CLI; no fake Orca execution or unverified plugin installation was added. OpenCode `1.18.30` is already available as a controller spawn/orchestration candidate and now has a route regression test. Verification: `npm test` 318/318, `npm run typecheck`, plugin tests 3/3.
## [2026-09-19] change | Provider-neutral workspace secret loading

Added `packages/core/src/config.ts` secret discovery and a dotenv parser. The proxy now loads only
the environment names referenced by enabled upstreams and Jev, with existing process variables
winning over `SABI_SECRETS_FILE`, the nearest workspace `secrets/.env`, and the per-user Sabi file.
The provider-name alias fallback accepts the current HugoOS `typesafe=` entry without requiring a
provider-specific integration. `packages/server/src/index.ts` activates it at startup and reports
only a count and path, never values. `scripts/setup.ts` now points users at the discovered file
instead of incorrectly requiring an exported shell variable.

Updated EN/PT-BR/ZH README and install/harness docs for users of OpenRouter, Ollama, OpenCode,
Hermes, Kilo, Command Code and other clients; the proxy remains the shared boundary and Orca is
not required. No secret file was changed. Validation: 262 Node tests, focused config tests 17/17,
typecheck, and a no-provider-call startup with shell keys unset loaded 2 configured keys.

## [2026-09-19] feat | Installable Sabi CLI boundary

Added `sabi` bin entries to the root and controller manifests and exposed `route`, `status`,
`agents`, `doctor`, `config`, and `logs`. Status commands use the existing live Orca inventory
and explicit `--cwd`; they report `local-cli`/`daemon not-configured` rather than implying a
background service. Hardened the controller log reader against parsed non-object rows. Focused
CLI tests: 9/9; full suite: 324/324; typecheck clean; offline eval completed as measurement. Automatic user daemon and harness hooks remain unimplemented.

## [2026-09-19] feat | User-level controller daemon slice

Added `packages/controller/src/daemon.ts` and the shared controller runtime. `sabi setup` persists
non-secret user preferences and can start a detached loopback daemon; `sabi route` uses it after
setup and safely falls back locally; `status`/`agents` query its live inventory; `daemon --status`
and `daemon --stop` manage it. The daemon exposes `/health`, `/status`, and `/route` and reuses the
existing Orca execution path. Added isolated daemon startup/protocol tests and setup coverage.
No host hooks, system login service, Laya adapter, model registry, or outcome-learning store was
added; those need verified host contracts and durable outcome evidence first.
Validation: 327/327 Node tests, typecheck, and offline eval completed; eval remains a measurement.

## [2026-09-19] feat | Claude, Codex and OpenCode controller hooks

Added `sabi setup --hooks`, `sabi hooks install`, and the Claude/Codex `UserPromptSubmit` bridge.
Added a thin OpenCode `chat.message` plugin that plans through the loopback daemon before dispatching
delegation, spawning, or orchestration. Existing JSON config is merged with one backup; `CONTINUE`
stays in the current harness and all hook failures fail open. Added `/plan` to keep planning separate
from execution and focused tests for config preservation, idempotence, receipts, and OpenCode message
mutation. No real user config, paid task, or live Orca plugin activation was changed.

## [2026-09-19] feat | Controller traces and read-only replay

Added trace schema v1 fields for bounded candidates and execution duration, while preserving the
existing decision, handoff and receipt records. Added `sabi replay --last=<n>` as a read-only summary
of recorded actions, rules and execution outcomes; it does not invoke Orca, a harness or a paid task.
Added CLI and daemon regression coverage. Policy re-execution and automatic lesson compilation remain
the next phase after enough real outcome data exists.

## [2026-09-19] docs | Controller delivery and package release boundary

PR #22 merged to `main` as `4c88fdb`. Updated the agent instructions, bilingual README/install docs,
handoff, decisions log, research scope note and release workflow to distinguish the experimental
source-only controller/Orca bridge from the public `@vizuh/sabi` Command Code package release. The
existing `v0.1.2` release remains the latest package release at `35560c0`; no artificial package tag
was created for controller-only changes. Validation is source/test and merged-state evidence only;
installed user-config mutation, live OpenCode activation in Orca and real cross-terminal execution
remain unclaimed.

## [2026-09-19] plan | Public installation and global host integration

Defined the production installation lane: bundle the private controller into a public
`@vizuh/sabi-controller` package, install a per-user daemon/service, register consented harness
adapters, maintain a global session registry, and prove clean-machine installation plus live terminal
receipts before release. Kept the existing `@vizuh/sabi` Command Code package separate. The full
sequence and support matrix are in `docs/research/public-installation-plan.md`; `npm link`, a PATH
entry, a spawn candidate or an Orca manifest alone do not satisfy the public acceptance bar.

## [2026-09-19] docs | Optional local design evidence boundary

Recorded TokenScout-like site analysis as an optional local evidence provider rather than a Sabi
dependency. Raw reports, Design DNA, screenshots, assets and URLs stay under ignored local runtime
state; a future routing consumer may accept only bounded evidence flags and a soft model-affinity
prior. Kimi K3 remains a local hypothesis for reference-driven visual work, not a hard-coded public
route. No URL was studied and no TokenScout dependency or site artifact was added.

## [2026-09-19] feat | Public controller package boundary

Added the first external-installation slice for the controller. `npm run build:controller` creates a
self-contained `@vizuh/sabi-controller` staging package with the CLI, daemon, hooks and integration
resources; `controller-v*` has a separate release workflow from the existing `@vizuh/sabi` adapter.
Hook commands resolve the installed entrypoint absolutely. The clean-prefix test builds, packs,
installs and executes the generated tarball without the source checkout. No registry publication,
login service, universal Orca activation or cross-terminal execution is claimed yet.

## [2026-09-19] feat | Global Orca candidates and structured handoff

Orca inventory now retains eligible idle sessions from other visible worktrees instead of filtering
everything to the caller's `cwd`. Cross-worktree dispatch includes a bounded JSON handoff with objective,
source context, changed files, tests/results, diff and next step. Added regression coverage for global
inventory and the permanent `2 + 2` smallest-route rule. Persistent non-Orca session registration and
live cross-terminal receipts remain separate gates.

## [2026-09-19] feat | Linux user service boundary

Added a minimal `systemd --user` installer behind `sabi setup`: absolute Node/CLI paths, user-scoped
state, restart-on-failure and explicit lazy fallback when the user bus is unavailable. Added
`sabi integrations list|repair` so PATH discovery is labelled `executable-only` rather than treated
as proof of a controller adapter. macOS/Windows service installation and uninstall rollback remain
unvalidated.

## [2026-09-19] security | Authenticate local daemon clients

Added a random per-user bearer token to the daemon info record and require it for loopback requests;
OpenCode reads the same user-scoped token and sends it without handling provider credentials. Wrong
tokens receive 401, missing daemon/token still fails open in the harness hook. No remote bind is
enabled.

## [2026-09-19] security | Redact terminal preview context

Live global inventory showed that terminal previews may contain reset URLs or credential-like values.
Added boundary redaction for common query tokens, API keys, bearer values and password/secret
assignments before previews become session context; raw screen text remains internal to capacity
classification and is not persisted as a candidate descriptor.
The live post-fix scan observed 34 worktrees/12 sessions and zero unredacted credential-pattern
matches in returned descriptors.

## [2026-09-19] release | Make the scoped controller package public

The generated `@vizuh/sabi-controller` manifest now declares public access and the tag workflow passes
`--access public`. The clean-prefix package test asserts the generated publish contract before any
registry publication.

## [2026-09-20] verify | Global setup and clean-install CI

PR #28 (`feat/global-installation-phase2`) now detects real installed host sessions, preserves the
current hook session identity, and keeps the global registry bounded and hashed. The package test
proves the generated controller runs from a clean npm prefix; harness-detection tests use isolated
temporary executables so CI does not depend on which tools happen to be installed on the runner.
CI run `35475422114` passed typecheck, 351 tests, and the clean-prefix package test. No npm
publication, controller tag, universal Orca activation or live cross-terminal execution is claimed.

## [2026-09-20] security | Close global controller boundary findings

The independent phase-2 review found that a configurable OpenCode URL could receive the daemon
bearer token and that persisted controller records retained raw requests, handoffs, diffs and
terminal handles. The daemon now rejects non-loopback hosts and metadata, the OpenCode bridge fails
open for non-loopback URLs, and persisted/read controller logs omit those sensitive fields while
retaining routing metadata and request length. Added focused regressions for both boundaries.
Live per-runtime receipt evidence and universal Orca activation remain release gates.

## [2026-09-20] hardening | Host-native continuation and safe hook removal

Marked hook-only current sessions `dispatchable: false` so the planner and executor distinguish a
request that remains with its native harness from a real Orca terminal dispatch. Uninstall now
matches Sabi hook structure (`statusMessage` plus command) rather than a broad substring, preserving
third-party hooks that happen to mention a harness. Full suite remains green at 354 tests.

## [2026-09-19] feat | Route across local Command Code and OpenCode plans

Added controller preferences for `opencode` then `command-code`, exact local model-catalog checks,
and Orca capacity-aware fallback across `opencode`, `command-code`, `claude`, `codex` and optional
`hermes`. `cmd --list-models` and `opencode models` are local setup checks;
they are combined with live quota/session state, so the current quota-exhausted Command Code Sabi
session selects the available OpenCode Sabi session. New terminals carry the verified model through
`--model`; existing sessions are not silently switched. Verification: 348 Node tests and typecheck
passed; live status and a pure routing proof ran read-only, with no paid task dispatched.

## [2026-09-20] feat | Add cross-platform user service lifecycle

Added idempotent user-service implementations for macOS LaunchAgent and Windows Task Scheduler beside
the existing Linux `systemd --user` path. All service launchers use absolute packaged entrypoints and
user-scoped state; install/remove command paths and rendered service definitions are tested without
touching a real foreign OS. Live macOS/Windows startup remains an explicit release gate.

## [2026-09-20] fix | Bounded quota reroute across eligible candidates

A live quota probe showed the controller stopping after a single fallback attempt. `fallbackTarget`
now takes the set of failed target ids, consults a refreshed inventory per attempt, and falls back
to spawn candidates when sessions are exhausted; `runController` retries up to `MAX_REROUTES = 3`
and records `rerouteCount` on each retry. A regression test with a fake Orca CLI replays the exact
case (first target quota-fails, second target receives and completes). Focused `controller.test.ts`
4/4 passed, `npm run typecheck` clean. The branch change remained uncommitted at entry; the live
retry and final validation are recorded below.

## [2026-09-20] verify | Exercise live quota rerouting

Ran the requested read-only check through the real Orca inventory. Sabi detected a quota-exhausted
active Codex session, selected OpenCode, observed receipt plus quota/rate-limit failure, refreshed
inventory and rerouted without a false success. The remaining live targets also reported unavailable
capacity, so `QUOTA_HANDOFF_OK` was not produced. The retry loop is now bounded to three replacement
attempts; this result remains a recovery proof, not a successful cross-terminal completion.

## [2026-09-20] verify | Validate free Command Code and OpenCode lanes

Read-only live checks used temporary state/configuration only. Command Code's real catalog exposed
explicit free models; the Sabi mod routed a continuing round from `poolside/laguna-s-2.1-free` to
`inclusionai/ling-3.0-flash-sante:free`. Headless permissions blocked the requested shell tool, so
no task completion was claimed. A real OpenCode session with the Sabi plugin and loopback daemon ran
`opencode/big-pickle`, executed `node --version` as `v24.15.0`, and returned `OPENCODE_SABI_OK`; the
controller trace was `CONTINUE` with the host session non-dispatchable. The explicit
`opencode/jev-1.13-free` probe produced no receipt within the bounded budget and was interrupted;
no retry or false success was recorded.

## [2026-09-20] change | OpenCode advertises image input where tiers declare it

`packages/adapters/opencode/src/connect.ts` (`sabiModels`) now derives per-alias input modalities from the tiers the alias can serve (`tiersFor`): `image` is advertised only where a reachable tier affirmatively declares it in `capabilities.inputModalities`. With the shipped config that is `sabi-code`/`sabi-mid`/`sabi-strong` (mid/strong declare image, verified live against the OpenRouter models API 2026-09-20: flash-0731 text-only, luna and sonnet-5 text+image+file); `sabi-cheap` stays text-only. Previously every alias advertised text-only, so OpenCode had no path to send images at all. `docs/install.md` OpenCode paragraph updated (it still said text-only).

Validation: typecheck clean, opencode adapter tests 6/6 (1 new), writer re-run against the live profile (backup preserved, not rewritten), and a live proxy check — image request on `sabi-cheap` returns the designed `400 incompatible route 'cheap': input modality 'image' is not supported` with no upstream spend. No live image round-trip yet: that would route to mid and spend real credit, so it waits for a real user message with an image.

## [2026-09-20] fix | SSE tap accepts a usage chunk restating the terminal choice

`sabi/sabi-code` in OpenCode looped forever resetting: every adaptive round routed `sabi-code -> mid -> openai/gpt-5.6-luna` and died after one chunk with `upstream response failed`. Direct OpenRouter calls succeeded (credit fine), `sabi-cheap` + tools streamed fine, and a raw upstream capture showed the cause: OpenAI-via-OpenRouter repeats `finish_reason: "stop"` with an empty delta on its final usage-bearing chunk, and the tap's post-terminal guard rejected it as `upstream stream choice continued after terminal finish` — the client saw a destroyed mid-stream response (502) and retried forever. `packages/server/src/sse.ts` now tracks the terminal reason per choice and allows that idempotent restatement (same reason, no content, no tool calls); real post-terminal deltas still reject, and the existing regression test passes unchanged.

Validation: typecheck clean, server SSE suite 8/8 (1 new: luna-shaped echo accepts, usage recorded), live probes `sabi-mid` + `sabi-code` (as `client: opencode`) both complete with `[DONE]` and `outcome: ok` for fractions of a cent.

## [2026-09-20] docs | Pin runtime versions behind mutable catalog evidence

Followed up the merged PR #31 review. `docs/decisions.md` now qualifies the boundary as
inference-round scheduling plus the existing pre-session controller, with Orca lifecycle settlement
remaining an optional adapter. It records the exact live trial runtimes: `orca-ide 1.4.201`,
OpenCode `1.18.31`, and Node `v24.15.0`.

Refreshed the free-plan probes without changing user configuration: Command Code `1.58.0` reported
72 models via `cmd --list-models` and currently marked only
`inclusionai/ling-3.0-flash-sante:free`; OpenCode `1.18.31` reported 46 entries via the
`opencode models` command, including seven `opencode/*-free` entries. The full-output hashes are recorded in
`docs/handoff.md`. Neither installed runtime exposed a source repository/commit, so these remain
version-pinned runtime observations, not source-pinned benchmark claims. `docs/handoff.md` also
records the remaining provenance and post-upgrade rerun gates.

## [2026-09-20] verify | Read-only Sabi review on an OpenCode free plan

Ran the review through the real OpenCode CLI `1.18.31` with
`opencode/ling-3.0-flash-fin-free`, the same-repo Sabi plugin, a temporary loopback controller
daemon, and an explicit `/tmp/sabi-runtime-evidence` directory. The model returned
`SABI_FREE_REVIEW_OK` after checking the three PR #31 follow-up findings. The Sabi trace observed
34 worktrees and 14 sessions and recorded Jev selecting bounded `CONTINUE`; the request stayed in
the native OpenCode session, with no cross-session dispatch, paid upstream request, or file edit.
The first attempt was discarded from evidence because OpenCode resolved the canonical dirty
checkout; the corrected `--dir` run is the only accepted result. Full validation: 366 tests passed,
`npm run typecheck` passed, and `git diff --check` passed.

## [2026-09-20] feat | Record harness model catalogs as bounded routing evidence

Added the first executable slice for the harness × model × provider/plan × effort × session
contract. The controller now probes verified OpenCode/Command Code catalog commands, records model
IDs with deterministic `worker`/`judge` roles, marks only explicit `free` suffixes as
`explicit-free`, and preserves runtime version, observation time, model count, truncation state and
full-output SHA-256. Missing source revision, entitlement, price, quota and token usage remain
unknown; native OpenCode sessions are not silently switched.

Added focused inventory coverage for parser classification and the real discovered OpenCode spawn
candidate path, plus `docs/research/harness-model-token-routing.md`. Updated context, decisions,
handoff, README, install and research-plan docs to separate implemented catalog evidence from
planned token receipts, AgentRun-style replay/lessons and SoL-Pi-style harness optimization.

Validation: `npm test` passed 368 tests, `npm run typecheck` passed, focused controller/inventory
tests passed, and `git diff --check` passed. No user configuration, secrets, paid inference or live
terminal execution was changed.

## [2026-09-20] change | Product-first narrative and controller receipt hardening

Reordered the English README around the visitor's first questions: what Sabi gives, model versus
harness routing, one recommended path, current compatibility, an illustrative trajectory, Jev's
role and the absence of a published benchmark. Added `docs/visual-story.md` with source-grounded
hero, cognitive-load, local-evidence, recovery, new-model and end-state visuals; examples are
marked illustrative and never present catalog presence as quality, price or entitlement evidence.

Completed the existing controller receipt slice: bounded idempotency keys now correlate plan/route
and outcome, execution retries require pre-acceptance, OpenCode credits the actual execution target,
and the same request reuses a short-lived inventory snapshot. Command Code catalog headings and
docs text are excluded from model IDs, and Jev catalog entries cannot satisfy worker preferences.

Validation: 373 tests passed; `npm run typecheck`, `npm run eval` and `git diff --check` passed. The
offline eval reported 5/8 tasks passed, 3/3 failed tasks escalated and -388.4% versus all-mid
repricing; this is a development warning, not a customer benchmark. No paid inference, live
dispatch, user configuration change, publication or deploy.

## [2026-09-20] fix | Harden controller receipts, inventory freshness and Jev boundaries

Typed Orca result parsers now reject unknown envelopes as `unverifiable`; controller-side idempotency
keys are carried through route execution and outcome telemetry; completed/in-flight requests are
deduplicated within one daemon process. Inventory reuse is capped at two seconds and quota/rate-limit
retries force refresh. Jev state is bounded and excludes catalogs/raw diffs; OpenCode and host hooks
only suppress the current prompt after a verified receipt. A quota test covers pre-acceptance input
with no observed request and successful reroute; accepted input is not retried.

Validation: `npm test` 373/373, `npm run typecheck`, focused daemon/OpenCode tests 10/10, and
`git diff --check`. No live task, secret, paid inference, deployment or publication.

## [2026-09-20] fix | Close post-merge controller review findings

Applied the actionable findings from the last ten merged PR reviews. Session heartbeats now
preserve the latest outcome receipt; delegated OpenCode outcomes use the actual target harness;
Claude/Codex hook planning carries the same idempotency key as routing; configured Jev bounds are
respected below 512 characters; and preferred models remain discoverable beyond the bounded catalog
telemetry cap. Catalog membership alone no longer proves plan entitlement for a preferred spawn
target, so catalog-only targets stay unavailable until a live session provides capacity evidence.

Uninstall now removes Sabi-only hook/plugin configuration even without a backup, and upgrades restart
an installed native user service instead of silently starting a detached daemon. The free OpenCode
review wording now distinguishes a free OpenCode model request from any configured Jev billing.

Validation: `npm test` passed 378/378, `npm run typecheck` passed, focused controller/adapter tests
passed 35/35, and `git diff --check` passed. No live task, secret, user configuration, deployment or
paid model request was changed by this patch.

## [2026-09-20] feat | Complete the pinned Hermes native proxy-routing contract

Formalized the Hermes V1 adapter and task checklist. The thin public `llm_request` middleware
preserves the complete request, adds validated opaque session/turn attribution, and leaves
per-request model/effort/provider scheduling to the existing Sabi proxy behind `sabi-code`.
Updated compatibility, harness, install and handoff docs to distinguish the certified main/resume
path from uncertified auxiliary calls, direct provider rebinding, paid quality and ContextEngine
replacement.

Validation: 12 Hermes adapter tests passed; direct Hermes → mock and Hermes → actual Sabi → mock
probes both exited `passed_with_metadata_probe_limit`. The Sabi probe recorded three unique request
receipts, `mid → cheap → mid`, one hashed session, two hashed turns, `client: hermes`, `outcome: ok`,
and preserved the tool call/result. The full Node suite passed 378/378, `npm run typecheck` passed,
and `git diff --check` passed. No secrets or paid inference were used. Specs and deferred gates are
in `docs/specs/hermes-sabi-routing.md` and `docs/tasks/hermes-sabi-routing.md`.

## [2026-09-20] feat | Add receipt-aware OpenCode model health and fail-open fallback

Added the smallest next gate after catalog evidence: controller execution receipts now record the
selected harness model, bounded elapsed receipt latency, outcome and process-local health counts.
Configured OpenCode/Command Code worker selection skips a recently failed preferred model when a
second valid worker exists, then fails open to the first valid worker if all configured workers
are unavailable. Unverifiable receipts remain unknown and no paid probe or entitlement inference
was added.

Added focused health and fallback tests plus `docs/specs/opencode-model-health.md` and
`docs/tasks/opencode-model-health.md`; the research contract now names the live free-model receipt
gate as the next step.

Validation: `npm test` passed 381/381, `npm run typecheck` passed, and `git diff --check` passed.
No live provider request, user configuration, secret, deployment or publication was performed.

## [2026-09-20] verify | Observe a bounded free OpenCode receipt through Sabi

Ran a temporary read-only OpenCode session with OpenCode `1.18.31`, Node `v24.15.0`, Orca
`orca-ide 1.4.201`, `opencode/ling-3.0-flash-fin-free`, the Sabi plugin and an isolated loopback
daemon at `127.0.0.1:7543`. The model read only a temporary README and returned
`OPENCODE_SABI_MODEL_HEALTH_OK` with exit code 0. The plugin registered the session; Sabi observed
36 Orca worktrees and 17 sessions, chose deterministic `CONTINUE` from the bounded action set, and
left controller execution `not-started` because the native current session was sufficient.

The catalog contained 46 entries and seven explicit free OpenCode worker IDs; output SHA-256 was
`4b1c758f744cc2d004827fb2dea8c331ef645e6fbb971d57bbcd4ef882f9afd6`.

This is free-model/native-plugin evidence, not controller-spawned model-health or fallback proof.
No Sabi checkout, user harness configuration, secret or paid provider was changed.

## [2026-09-20] fix | Prefer same-harness model fallback after pre-acceptance failure

The controller retry path now preserves the failed harness identity and chooses the next available
configured worker from that harness before an unrelated idle session. Added a full controller test
covering natural `SPAWN`, fake quota failure before acceptance, process-local model demotion, fresh
inventory, second-model spawn and successful completion receipt.

Validation: focused controller/inventory/model-health tests passed 18/18, full `npm test` passed
382/382, `npm run typecheck` passed, and `git diff --check` passed. The fake-Orca test is not live
quota evidence; no paid request, secret, user configuration or deployment was changed.
