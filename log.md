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
