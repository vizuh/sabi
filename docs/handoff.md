# Handoff Notes
## Free-only across every adapter + 10-mark router gap-check — 2026-09-23

Hugo's rule (OpenRouter serves free or Jev only) now holds across every shipped profile, not just
the root config. Both Hermes examples carried a bare `openrouter` upstream with paid ids; both now
declare `paidModelsAllowed: false` with `:free` ids + `cost 0`, and a new guard test
(`packages/core/test/openrouter-free-only.test.ts`) fails `npm test` on the next paid-id edit.
Other adapters (command-code, opencode, orca, oh-my-pi, prime-agent, deepseek-harness) declare no
OpenRouter upstream — they inherit the proxy dispatch gate. Validation: `npm test` 580/580,
`npm run typecheck` clean. Details in `docs/decisions.md` (2026-09-23 entry) and `log.md`.

10-mark gap-check vs the 2026-09-22 router survey (trajectory routers: ACRouter, vLLM SAAR,
BitRouter, Autohand Routes, pi-smart-router + verification/escalation mechanics): Sabi fully hits
8 — trajectory-aware routing (`state.ts`/`policy.ts`/`router.ts` + `RouteContext`), harness-
independent proxy execution, tool/failure/context signals, free-model QA (`--free-quality`,
`sabi-quality`, surplus shadow reviews), independent Jev judge (bounded, fail-open) + council/
surplus receipts, automatic escalation with billing/capability fallback, cache-aware switching
(`cache-routing.ts`: same-tool-cycle pinning, switch economics, escalation override), per-route
telemetry (`decisions.jsonl`, allowlist-only). Two deliberate partials: (1) reasoning-effort is
scheduled only on the harness-native path (`harness.tiers[].effort`); the proxy validates and
forwards `reasoning_effort` but does not schedule it per round. (2) Learning from verified
outcomes is shadow/backtest-only by constitution (`profiler.ts`, fixture-only replay, no online
promotion) — unlike ACRouter/BitRouter closed-loop policy updates. No commit, push, deployment
or publication.
## OpenRouter free-models-only rule, enforced — 2026-09-22

Hugo's standing rule — the OpenRouter upstream serves free models and Jev only — was being
violated in production. `.sabi/decisions.jsonl` records 242 rounds on `openai/gpt-5-mini`, 161 on
`openai/gpt-5.6-luna`, 18 on `anthropic/claude-sonnet-5` and 483 on the priced
`deepseek/deepseek-v4-flash-0731`, all `upstream: openrouter`. The config was corrected, and the
rule is now a hard constraint in code rather than a property of one config file:
`UpstreamEntry.paidModelsAllowed` plus `isFreeModel`/`servesUpstreamBilling` in
`packages/core/src/compatibility.ts`, enforced at `ensureRouteCompatible` and in every tier
candidate filter (`route()`, `getFallbackChain`, judge `retier`), with `rule: 'billing'` naming
the reason.

`sabi.config.json` now maps cheap/mid/strong to `:free` OpenRouter ids verified live by a real
completion on 2026-09-22 (`poolside/laguna-s-2.1:free`, `dots-studio/dots-3-note-preview:free`,
`nvidia/nemotron-3-ultra-550b-a55b:free`), keeps Ollama as the keyless local tier, and leaves Jev
on TypeSafe. `docs/install.md` documents the new key; rationale in `docs/decisions.md` and
`log.md`.

Validation: `npm test` 575/575 (1 new guard test), `npm run typecheck` clean. Live:
`sabi-proxy.service` restarted on the new config, all four aliases returned HTTP 200, and the four
new decision rows are all `:free` models. A throwaway proxy with `mid` repointed to
`openai/gpt-5-mini` returned HTTP 400
`upstream 'openrouter' is free-models-only and 'openai/gpt-5-mini' is not zero-priced`, and its
adaptive round rerouted to the free cheap tier — no spend. Known tradeoff: the shared free pool
rate-limits under load (one probe answered 429); `transportFallback` stays `false` so that is
visible. Not verified: OMP-native per-round behaviour on the new tiers, and free-tier throughput
under a long session. No commit, push, deployment or publication.

## Oh My Pi provider adapter — 2026-09-22

Added `packages/adapters/oh-my-pi`, a side-effect-free Oh My Pi 18.2.8 extension that registers the
local Sabi OpenAI-compatible proxy as `sabi/sabi-code`. OMP keeps its native loop, history, tools,
approvals, compaction, cancellation and retries; Sabi chooses the upstream model behind the stable
alias. The adapter rejects non-loopback endpoints and never copies provider credentials into OMP.

The compatibility proposal is `docs/research/oh-my-pi-adapter.md`; user instructions are in
`docs/adapters/oh-my-pi.md`. Evidence is source review, four contract tests, and an installed OMP
18.2.8 non-interactive streaming smoke against a loopback mock (`OMP_SABI_SMOKE_OK`). Full
`npm test` passed 572/572, `npm run -s typecheck` passed, and `git diff --check` passed. No real
upstream request, user configuration, credential, deployment or publication was used.

## Cache-aware model continuity + structured fallback handoff — 2026-09-21

The scheduler now keeps the selected model through the same tool cycle and evaluates a change only
at a new phase, failure or explicit escalation. Provider usage records `hit`, `miss` or `unknown`
cache status; when a cache is warm, a phase change is retained unless the measured cost saving is
greater than the estimated context reprocessing penalty. Hard failures and recovery actions remain
explicit switch exceptions. Decision logs and `sabi report` expose the bounded cache evidence.

Controller replacements and spawned terminals now receive a bounded structured capsule containing
the objective, current plan, changed files, tools, failures, tests/verifications, results and next
action. The current source session continues with the native harness request. The stale second Jev
routing override was removed; Judge remains a separate bounded execution evaluator, and cache-kept
rounds do not let it replace the serving model or rewrite the main conversation.

Validation: core 227/227, server 96/96, adapters 61/61, eval/scripts 41/41 and controller 128/128
passed in isolated groups; the sequential controller-plus-setup run passed 154/154; `npm run
typecheck` and `git diff --check` passed. The default parallel `npm test` reached 552/553 because
one setup assertion about `git-tracked` output failed only in that combined run. No commit, push,
deployment or external publication was performed.

## OpenCode sandbox/pollution guards + Cline recipe (PR #92 keepers) — 2026-09-21

Supersedes PR #92 (closed CONFLICTING): keeps only its independently-mergeable commits —
the OpenCode 1.18.31 sandbox fix (`Bun.env` + type-guarded env reads), ephemeral-registration
refusal with stale-entry pruning and doctor reporting, and the Cline provider recipe with
protocol fixture. The Jev-routing/dashboard/catalog WIP and its conflict wreckage stay on
the old branch; its `sabi models suggest` needs a fix for `:batch` recommendations (live
404 on `chat/completions`) before merging.

## Current status

`main` includes the global controller, Claude/Codex hooks, OpenCode bridge, Orca inventory/handoff,
bounded reroute, trace schema v1, runtime-pinned free-catalog evidence and read-only replay. The
source/test boundary is validated; installed user-config mutation, universal Orca activation and
real cross-terminal completion remain separate evidence gates. The public `@vizuh/sabi` release
publishes the inference adapter, and `@vizuh/sabi-controller@0.1.0` is the separate bundled controller
release for supported hooks and the user-level daemon. Publication does not promote live host receipts
or universal Orca activation into verified runtime support.

The pinned Hermes 0.21.3 adapter is now a completed V1 native proxy-routing path: Hermes owns its
loop and execution, the public `llm_request` middleware adds opaque session/turn attribution, and
Sabi schedules each request behind the `sabi-code` alias. The isolated native probe verifies a real
tool loop, resume, three unique Sabi request receipts and shared-core routing `mid → cheap → mid`.
Direct provider rebinding, auxiliary/subagent calls, compaction replacement and paid-provider
quality remain explicit separate gates.

## Hook/upgrade/startup hardening (#71, #73, #76) — 2026-09-21

Branch `muse/hooks-lifecycle` (unpushed): controller upgrade installs with
`--ignore-scripts` plus an `npm audit signatures` gate, server startup reports
a busy port in one line and never echoes a pasted credential, uninstall removes
`.sabi-backup` instead of resurrecting deleted configs, `SABI_HOOK_COMMAND`
rejects shell metacharacters at install time, and `sabi doctor` reports stale
absolute hook paths. Validation: `npm test` 435/435, `npm run typecheck` and
`git diff --check` clean. Live host activation and cross-terminal execution
remain separate evidence gates.

## Host-AI onboarding and OpenRouter-only credential path — 2026-09-20
The checkout setup wizard now supports a localized, question-led onboarding path for the existing
Command Code, OpenCode and Hermes adapter surfaces: `--language=en|pt-BR`, explicit Hermes
`--upstream=openrouter|hermes-nous`, and `--explain=local|ai`. OpenRouter is the only credential it
can collect, using hidden TTY input and a user-scoped mode-0600 secrets file; Jev is opt-in through
`--jev` and is no longer an interactive second-key question. `--explain=ai` is one explicit direct
OpenRouter request with a local fallback, not a Sabi-routed coding turn.

The new `docs/install.ai.md` is the canonical runbook for a host AI. It distinguishes native
Command Code subscription routing, OpenCode/Hermes proxy routing, and Claude/Codex controller hooks.
OpenRouter BYOK priority/fallback remains an OpenRouter account setting; Sabi never receives the
underlying provider keys or transfers OpenCode Go, ChatGPT Plus, Nous or Claude subscriptions.

Validation: `npm test` passed 387/387, `npm run typecheck` passed, `git diff --check` passed, and the
generated OpenRouter Hermes profile passed config validation through the setup integration test.
The controller and Command Code package release gates are tracked separately below; no real key, paid
request or user harness configuration was used by this onboarding work.

## OpenCode model health and fail-open selection — 2026-09-20

The controller now records process-local health for the selected harness/model when an execution
receipt returns: outcome (`ok`, `failed` or `unverifiable`), bounded sample counts, observed
latency and timestamp. A failed preferred OpenCode worker is temporarily skipped when another
configured catalog worker is valid; if every configured worker is unavailable, selection returns
the first valid worker as a fail-open boundary. The model and health record are retained in the
bounded execution evidence and candidate telemetry.

This is not first-token telemetry, entitlement/quota proof, durable health, learned economics or
automatic paid probing. `unverifiable` stays unknown. A bounded free OpenCode receipt has now been
observed below; it proves the native free-model/plugin path and a `CONTINUE` controller decision,
not a controller-spawned model-health execution receipt. A controller retry now prefers the next
configured model in the failed harness before an unrelated idle session.

## Same-harness model fallback — 2026-09-20

The controller keeps the failed pre-acceptance harness/model excluded, refreshes live inventory,
and tries the next available configured worker from that same harness before selecting an unrelated
session. A focused fake-Orca integration test proves the complete local chain: natural `SPAWN`,
quota receipt before acceptance, first model marked `unavailable`, second model spawned, completion
receipt returned and second model marked `healthy`.

This is bounded execution evidence, not live quota evidence. The remaining live gate is an explicit
quota/fallback observation on an addressable controller target without a paid request or user
configuration change.

Validation: `npm test` passed 382/382, `npm run typecheck` passed, and `git diff --check` passed.
No paid provider request, secret, user configuration, deployment or publication was changed by
this phase; the bounded free OpenCode request is documented below.

## OpenCode free receipt probe — 2026-09-20

A temporary loopback run used Node `v24.15.0`, OpenCode `1.18.31`, Orca `orca-ide 1.4.201`, the
Sabi OpenCode plugin from the PR #38 tree and an isolated controller daemon on `127.0.0.1:7543`.
The current local catalog reported 46 entries, including seven explicit `opencode/*-free` worker
IDs; the full catalog output hash remained
`4b1c758f744cc2d004827fb2dea8c331ef645e6fbb971d57bbcd4ef882f9afd6`.

`opencode run --dir /tmp/sabi-live-model-health.iakYwm --model
opencode/ling-3.0-flash-fin-free` read only a temporary README and returned
`OPENCODE_SABI_MODEL_HEALTH_OK` with exit code 0. The plugin registered the native OpenCode
session, Sabi observed live Orca inventory (36 worktrees, 17 sessions, one harness candidate),
and the bounded action set was `CONTINUE`; the controller execution remained `not-started` because
the native current session was sufficient. No file in the Sabi checkout, user harness config or
paid provider was changed.

This is accepted as free-model execution evidence, not as proof that per-turn OpenCode model
switching or controller model-health recording works for a spawned terminal. That path still needs
a real addressable target and an explicit quota/fallback receipt.

## Product narrative and controller hardening — 2026-09-20

The README now leads with the user outcome, separates the in-harness inference scheduler from the
experimental cross-harness controller, gives one recommended install path, and states the current
compatibility/evidence boundary before the architecture. `docs/visual-story.md` captures the hero
trajectory, cognitive-load, local-evidence, failure/recovery, new-model and end-state visuals. Its
traces are explicitly illustrative until a real receipt supplies model, harness, runtime, outcome,
token and latency evidence.

The controller hardening completes the existing partial receipt work: one bounded idempotency key
can flow from a hook through plan/route/outcome, a shared short-lived inventory snapshot is reused
within a request, model-list headings are excluded, judge catalog entries cannot satisfy worker
preferences, and a failed or quota/rate-limited target is rerouted only before the send receipt
shows acceptance or turn start.
OpenCode outcome credit now follows `execution.targetId`, not the planned target, and missing target
identity stays uncredited. The registry now retains the bounded execution receipt. It is still not a
token/economic receipt; missing usage and cost remain unknown.

Validation: 373 tests passed, `npm run typecheck`, `npm run eval` and `git diff --check` passed. The
latest offline eval is 5/8 tasks passed, 3/3 failed tasks escalated, and -388.4% versus all-mid
repricing; this is a warning fixture, not a product benchmark. No paid request, live dispatch, user
configuration change, publication or deployment was performed by this change set.

## Last meaningful update

2026-09-21

## Logging privacy, observable failures, surplus egress — 2026-09-21

Closed issues #61 (salted identity hashing, `sanitizeError` gaps), #69 (silent log-write and
recovery-profile failures) and #70 (secret-path anchor, credential canaries) in this worktree.
Identity hashes are now per-install HMAC (`~/.config/sabi/.identity-salt`, mode 0600);
`appendDecision` never throws and records failures to stderr plus a sidecar the report surfaces;
`computeRecovery` skips shape-invalid rows; surplus/council egress refuses prefixed secret names
and common token shapes while ordinary source names stay admissible. Full details in `log.md`.

Validation: `npm test` 434/434, `npm run typecheck` clean, `git diff --check` clean. No paid
request, live dispatch, user configuration change, publication or deployment. Not pushed.

## Harness × model × token routing contract — 2026-09-20

Added `docs/research/harness-model-token-routing.md` and the first executable catalog slice. The
controller now retains bounded runtime evidence for verified OpenCode/Command Code catalog probes:
model IDs, deterministic `worker`/`judge` role, explicit-free/unknown cost class, runtime version,
observation timestamp and full-output SHA-256. It deliberately does not infer paid status, plan
entitlement, quota or source commit when the installed runtime does not expose them. Existing
OpenCode sessions keep their current model; only a controller-spawned terminal receives an exact
`--model` selection.

The design now explicitly treats `(harness, model, provider/plan, effort, session)` as the route
unit and puts availability, capability, quota and measured-token gates before Jev. The current
`sabi replay` remains telemetry aggregation; AgentRun-style lessons, policy compilation, controller
token receipts and SoL-Pi-style harness optimization are planned gates, not shipped behavior.

Verification in the dedicated phase worktree: 368 tests passed, including the new catalog tests,
and `npm run typecheck` passed. No user configuration, secrets, paid request or live terminal was
changed by this phase.

## OpenCode image modalities — 2026-09-20

The OpenCode writer advertised text-only input for every alias, so images had no path in. `sabiModels` now advertises `image` per alias from reachable-tier capabilities: `sabi-code`/`mid`/`strong` carry `text`+`image`, `sabi-cheap` stays text-only (verified live vs OpenRouter 2026-09-20: flash-0731 text-only; luna, sonnet-5 image-capable). Live proxy check: image on `sabi-cheap` → designed 400, no spend. No live image round-trip yet (would spend on mid).

## SSE post-terminal restatement fix — 2026-09-20

`sabi/sabi-code` in OpenCode looped forever resetting: every adaptive round died on mid/luna after one chunk. Cause: OpenAI-via-OpenRouter restates terminal `stop` with an empty delta on its final usage-bearing chunk, and the PR #4 tap guard rejected it as post-terminal corruption — the client saw a destroyed mid-stream response (502) and retried. `sse.ts` now tracks the terminal reason per choice and allows that idempotent echo (same reason, no content, no tool calls); real late deltas still reject. Live `sabi-mid` + `sabi-code` both `ok` with `[DONE]` after the fix.

## Public controller package — 2026-09-19

Built the first no-checkout installation boundary. `packages/controller/pack.mjs` bundles the CLI,
daemon, hooks, OpenCode plugin and Orca bridge resources into `packages/controller/pkg`; the generated
manifest is `@vizuh/sabi-controller` and the `controller-v*` workflow publishes it independently of
the existing `@vizuh/sabi` Command Code package. Hook commands use the installed Node/CLI paths, so
they do not depend on an interactive `PATH`.

Verification: `npm run build:controller`, `node --test scripts/test/controller-package.test.ts`,
`npm run typecheck` and the full suite remain the required gates. The package test performs a real
`npm pack`, installs into a clean temporary prefix, and runs the installed CLI without the checkout's
`node_modules`. No npm publication, macOS/Windows service, or universal Orca activation is claimed by
this local branch.

## Global Orca inventory and cross-worktree handoff — 2026-09-19

The controller inventory no longer discards idle Orca terminals solely because their worktree differs
from the request `cwd`. It keeps the terminal's real worktree/branch and can select it when the route
has a valid delegation path. Cross-worktree dispatch sends a bounded structured handoff containing the
objective, original request, source session, repository/worktree/branch, changed files, tests/results,
diff summary, unresolved work and next suggested step. The `2 + 2` regression remains deterministic
`CONTINUE` in the current session.

Verification: global inventory fixture and structured-handoff test pass; typecheck remains clean. This
does not yet create a persistent registry for harnesses outside Orca or prove a live cross-terminal
receipt against a paid/interactive session.

## Linux user service and integration inventory — 2026-09-19

`sabi setup` now attempts an idempotent `systemd --user` unit on Linux using the installed Node and
CLI paths, with `Restart=on-failure` and no root requirement. If the user systemd bus is unavailable,
the result explicitly records a lazy detached fallback. `sabi integrations list|repair` reports
detected executables as `executable-only` and keeps the verified controller bridge list separate;
finding Hermes, Pi, OMP or an Orca binary does not promote them to supported adapters.

Verification: service template and disabled-host tests pass, and the full suite remains green. The
macOS/Windows service paths, uninstall/rollback, persistent non-Orca session registry and universal
Orca prompt events remain unverified.

## Authenticated daemon transport — 2026-09-19

The loopback daemon now creates a random per-user bearer token in the mode-0600 daemon info file;
daemon clients send it on health, plan, status and route requests. OpenCode reads only that local
token (or an explicit `SABI_CONTROLLER_TOKEN`) and remains fail-open when the daemon is absent. A
request with the wrong token is rejected with 401. This is still a loopback transport, not a remote
service contract.

The generated scoped package now declares `publishConfig.access=public`, and the controller release
workflow passes `--access public`; the clean-package test asserts that manifest contract.

## Inventory context redaction — 2026-09-19

Live Orca inventory exposed that terminal previews can contain reset URLs or credentials. The
controller now redacts common query-token, API-key, bearer and password/secret assignments before
context reaches status, routing telemetry or handoff candidates. Raw screen text is still used only
inside the bounded capacity classifier and is not returned as a descriptor.

Live check against Orca 1.4.201 observed 34 worktrees and 12 sessions; a safe-pattern scan of the
returned descriptors found zero raw reset-token, bearer, API-key or password-assignment matches.

## Controller host hooks and release boundary — 2026-09-19

PR #22 is merged on `main`. The supported local controller setup is `npm link` followed by
`sabi setup --hooks` (or `sabi hooks install`); hooks fail open when the daemon is unavailable, and
they do not switch a paid subscription or a harness-selected model. `sabi replay --last=<n>` is a
read-only summary of recorded controller traces and does not replay a task.

The release workflow is package-scoped: a `vX.Y.Z` tag publishes the packaged Command Code adapter
after its package version is merged, then creates the matching GitHub Release. It does not publish
the private controller or Orca bridge. Do not create a new package release for controller-only source
changes until a publishable controller artifact and versioning contract are defined.

The next product phase is documented in [the public installation plan](research/public-installation-plan.md).
`npm link` is not a user-installation solution. The target is a bundled `@vizuh/sabi-controller`
package, a user-level daemon/service, consented host integrations and clean-machine acceptance across
supported harnesses. “Spawn candidate” and “executable on PATH” remain weaker than an integrated,
receipt-producing adapter.

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

## Public controller installation phase 2 — 2026-09-20

PR #28 (`feat/global-installation-phase2`) is merged into `main`. The controller package now treats
`sabi setup` as the explicit user-consent point: it detects real executable harnesses, installs only
the supported Claude/Codex/OpenCode bridges that are present, preserves existing configuration, and
passes the current host session identity through planning. A hook can therefore keep a trivial
request such as `2 + 2` in the current session even when the daemon also sees other Orca worktrees.
Sessions registered by an adapter remain bounded, hashed and non-dispatchable until that adapter
proves prompt delivery and outcome receipts.

The clean public-package path is verified without this checkout: the package is bundled, packed,
installed into a temporary npm prefix, and run with an isolated user state directory. CI run
`35475422114` passed `npm ci`, typecheck, all 351 tests, and the clean-prefix package test. The
portable harness-detection fixtures use temporary executable stubs only inside tests; production
still requires the real harness command to be present.

This phase is not a universal-installation claim. `@vizuh/sabi-controller` has not been published or
tagged, macOS/Windows user-service installers are not validated, and the installed Orca 1.4.201
surface has no verified universal prompt interception or plugin-install command. The next release
gate is a consented live host test with two worktrees and two real harnesses that proves terminal
receipt, execution, outcome and rerouting; only after that may a `controller-v*` tag publish the
package.

## Global controller security boundary — 2026-09-20

The independent phase-2 review found two release blockers and they are now fixed on PR #28: daemon
binding is loopback-only even when `SABI_CONTROLLER_HOST` is set, daemon metadata rejects non-loopback
hosts, and the OpenCode bridge fails open without fetching a non-loopback `SABI_CONTROLLER_URL`.
Persisted controller traces now omit raw request text, structured handoffs, diffs and terminal
handles; `sabi logs` returns routing metadata plus request length instead of replaying prompt content.
The live dispatch still carries the structured handoff to the selected terminal when required.

Focused security regressions cover remote URL rejection, no-fetch fail-open behavior, non-loopback
daemon refusal and log redaction. This closes the code-level P1 findings; it does not replace the
remaining live receipt gate for Claude, Codex and OpenCode or prove universal Orca activation.

The follow-up hardening also marks hook-identified host sessions as `dispatchable: false` and
preserves the host-native `CONTINUE` boundary, while uninstall removes only entries carrying Sabi's
structural hook marker instead of matching arbitrary command text. The public package remains gated
on real runtime receipt tests and publication approval.

## Cross-platform user-service implementations — 2026-09-20

The user-level daemon lifecycle now has native service implementations for Linux `systemd --user`,
macOS LaunchAgent and Windows Task Scheduler. Each uses an absolute packaged entrypoint, user-owned
state, idempotent install/remove commands and no root/admin escalation; Linux retains the detached
lazy fallback when the user bus is unavailable. Renderer and command-path tests cover all three
platform contracts from the Linux checkout. Live service startup still requires one validation run
on macOS and Windows before those platforms are called release-verified.

## Plan-aware Orca routing — 2026-09-19

The controller now reads optional `controller.preferredHarnesses` and per-harness
`preferredModels` from `sabi.config.json`. It verifies model ids against the local harness CLIs
(`cmd --list-models` and `opencode models`) and uses Orca's live terminal/session capacity as the
second gate. The current host showed `moonshotai/kimi-k3` in Command Code and
`opencode-go/kimi-k3` in OpenCode; the Command Code Sabi session was quota-exhausted while the
OpenCode Sabi session was idle/available. A read-only planner proof selected the OpenCode session
for delegation. The candidate set now covers `opencode`, `command-code`, `claude`, `codex` and
optional `hermes`; Hermes is not installed on this host, so it does not appear as a live candidate.

This is task-level controller routing: an existing OpenCode session keeps its current model, while
a newly spawned target receives the verified model via `--model`. It does not query a provider API,
copy credentials, switch an already-running native session, or claim per-inference cross-harness
routing. The change is source-only on `feat/public-controller-package`; no task was dispatched,
no terminal was spawned, and no merge or publication was performed.

Verification: 348 Node tests passed, `npm run typecheck` passed, and live `sabi status --json` plus a
pure `planAgentRoute()` check used the real Orca inventory without executing a request.

## Bounded quota reroute — 2026-09-20

A live quota probe (first target accepted then reported quota, second target also quota) exposed
that the controller stopped after a single fallback attempt. `runController` now retries only
new/eligible candidates within a bound (`MAX_REROUTES = 3`): failed target ids accumulate across
refreshed inventories, sessions are preferred, then the active session, then spawn candidates; each
retry records `reroutedFrom`/`rerouteCount` (`types.ts`). A regression test replays the exact case
(first target quota-fails, second receives and completes) against a fake Orca CLI.

Verification: focused `controller.test.ts` 4/4 passed, `npm run typecheck` clean. A second live
retry selected OpenCode from the real Orca inventory, observed terminal acceptance followed by a
quota/rate-limit status, refreshed inventory and rerouted without claiming success. All remaining
eligible targets were unavailable, so `QUOTA_HANDOFF_OK` was not produced. This is a recovery and
safety proof, not a successful cross-terminal completion.

Preservation note: this work lives in the linked worktree at `/tmp/sabi-global-controller`
(branch `feat/global-installation-phase2`, gitdir under
`www/products/sabi/.git/worktrees/sabi-global-controller`). A cross-device `git worktree move` to
`HugoOS/worktrees/sabi/global-installation-phase2` failed (`Invalid cross-device link`), so the
the change is now being finalized on that branch; no cross-device worktree move is required.

## Live quota reroute acceptance — 2026-09-20

A real controller run against the current Orca inventory observed 34 worktrees, 10 sessions and 5
spawn candidates. The active Codex session was quota-exhausted; deterministic routing selected an
available OpenCode session and sent the read-only `node --version` check through Orca. The terminal
accepted the input but reported quota/rate-limit state, so the controller refreshed inventory and
rerouted through additional eligible sessions/targets without claiming success. The final run did
not receive `QUOTA_HANDOFF_OK`; this is a recovery/safety proof, not a successful end-to-end receipt.
The recovery loop is now bounded to three replacement attempts and the structured handoff is retained.

## Free model and OpenCode live validation — 2026-09-20

The live Command Code catalog reported 72 models, including the explicitly free
`poolside/laguna-s-2.1-free` and `inclusionai/ling-3.0-flash-sante:free`. With a temporary
`SABI_CONFIG` that used only those IDs, a real `cmd` run loaded the Sabi mod and changed the
continuing round from `poolside/laguna-s-2.1-free` to `inclusionai/ling-3.0-flash-sante:free`.
The command tool was blocked by Command Code headless permissions, so this proves model
selection and request delivery, not shell execution or task success. No user config was changed.

The live OpenCode catalog exposed `opencode/*-free` entries. A real temporary OpenCode session
loaded the Sabi plugin, connected to the temporary loopback daemon, ran with `opencode/big-pickle`,
executed `node --version` (`v24.15.0`) and returned `OPENCODE_SABI_OK`. The Sabi trace recorded
`CONTINUE` / `current-session-sufficient`, a live inventory of 34 worktrees, 15 sessions and 5
spawn candidates, and kept the current host session `dispatchable: false`. This validates ambient
OpenCode + daemon operation and native harness continuation; it does not prove per-turn model
switching inside OpenCode. An explicit `opencode/jev-1.13-free` run was cataloged but produced no
receipt within the bounded smoke budget and was interrupted without retry.

The next OpenCode gate is therefore health-aware model selection: a local preference may nominate
free IDs, but the controller must record catalog presence, first-token/receipt latency and outcome,
then fail open or choose another valid model when a free endpoint is unavailable. Design-evidence
providers remain local/opt-in until a concrete task and outcome contract exists.

This historical capture did not record the installed runtime versions or source revisions, so its
catalog claims are retained for trace history but are unverified and superseded by the
runtime-pinned probe below.

## Runtime-pinned catalog evidence and PR #31 follow-up — 2026-09-20

PR #31 is merged. Its follow-up fixes now distinguish Sabi's inference-round scheduler and
pre-session controller routing from the optional Orca lifecycle adapter; the full decision is in
`docs/decisions.md`.

The mutable local catalog evidence was refreshed with these commands and versions:

- Command Code: `cmd 1.58.0` at `/home/hugocarvalho/.nvm/versions/node/v24.15.0/bin/cmd`; `cmd --list-models` reported 72 models and one explicit free marker,
  `inclusionai/ling-3.0-flash-sante:free`. Full-output SHA-256:
  `e2b0f2eff219032619fe258c585051fdec54cdc91d5ba3233818736c1637eb93`.
- OpenCode: CLI `1.18.31`, local `@opencode-ai/plugin` `1.18.4`; `opencode models` reported 46 entries,
  including seven `opencode/*-free` entries. Full-output SHA-256:
  `4b1c758f744cc2d004827fb2dea8c331ef645e6fbb971d57bbcd4ef882f9afd6`.
- Orca: `orca-ide 1.4.201`; the trial versions and lifecycle caveat are recorded in
  `docs/decisions.md`.

Neither installed catalog runtime exposed a source repository and commit in its version/package
metadata. The IDs and free labels are therefore runtime observations, not source-pinned benchmark
claims; repeat the probes after upgrades before treating a model as available. Next fix list:
preserve this provenance with every catalog refresh, rerun the Orca lifecycle probe after upgrades,
and do not publish a controller release from catalog presence alone.

The free OpenCode/Sabi review used `opencode run --dir /tmp/sabi-runtime-evidence --model
opencode/ling-3.0-flash-fin-free` with the Sabi plugin and a temporary loopback daemon. It returned
`SABI_FREE_REVIEW_OK`; Sabi observed the real Orca inventory (34 worktrees, 14 sessions), Jev chose
the bounded `CONTINUE` action, and execution remained native to the current OpenCode session. The
prompt was read-only, no file was edited, and no cross-session dispatch or paid OpenCode model
request was made. Jev was consulted according to the configured decision engine; its billing remains
subject to the configured TypeSafe account and is not included in the OpenCode execution claim.
Validation on this branch: 366 tests passed and `npm run typecheck` passed.

## Controller debate hardening — 2026-09-20

Implemented the next controller safety slice on `fix/controller-debate-hardening`:

- typed Orca parsers replace recursive `find*` result scans; unknown action shapes are
  `unverifiable`;
- controller-side idempotency keys correlate plan/route/execution/outcome and deduplicate completed
  or in-flight route requests within one daemon process;
- inventory is cached for two seconds and forcibly refreshed before bounded quota/rate-limit retry;
- Jev receives bounded candidate and handoff state, excluding raw catalogs, terminal transcripts and
  diffs;
- Claude/Codex/OpenCode hook blocking requires a verified execution receipt.

Validation: `npm test` passed 373 tests, `npm run typecheck` passed, focused daemon/OpenCode tests
passed 10/10, and `git diff --check` passed. No live task, user configuration, secret, paid request,
deployment or package publication was performed by this change. The PR and merge status are recorded
after GitHub CI completes.

## Post-merge review corrections — 2026-09-20

Implemented the actionable comments from the last ten merged pull requests:

- session heartbeats preserve the latest outcome and receipt;
- delegated OpenCode telemetry attributes the actual target harness;
- Claude/Codex hook planning and routing share one idempotency key;
- configured Jev state bounds are honored even below 512 characters;
- preferred models remain searchable after the bounded catalog telemetry list;
- catalog presence alone cannot authorize a preferred spawn without live capacity evidence;
- uninstall removes Sabi-only hook/plugin configuration when no backup exists;
- upgrades restart the installed native user service instead of falling back to a detached daemon;
- the free OpenCode evidence wording separates a free OpenCode model request from Jev billing.

The catalog-only spawn restriction is intentional: the installed catalog proves model identity, not
subscription entitlement or usable quota. A live session is therefore required before that fixed
preferred target can be treated as spawnable.

Validation on this worktree: `npm test` passed 378/378, `npm run typecheck` passed, focused
controller/adapter tests passed 35/35, and `git diff --check` passed. No live task, secret, user
configuration, deployment or paid model request was changed by this patch. Source delivery is through
the follow-up PR; remote CI and merge state remain separate from this local validation evidence.


## Product documentation reframe: 2026-09-20

The public docs now describe Sabi as a multi-adapter routing product.

- The root README separates inference routing from controller and session routing.
- Dedicated pages cover Command Code, OpenCode, Hermes, Prime Agent, Kilo, Claude Code, Codex, and Orca.
- The maintainer guide defines adapter operations and the evidence ladder.
- The estimates page shows token allocation, model-cost formulas, Jev overhead, and the limits of illustrative savings.
- An architecture SVG and Mermaid diagrams explain the two routing boundaries.

The evidence boundaries stay explicit. The published `@vizuh/sabi` package is still the Command Code
mod. The controller is checkout-based and experimental. Claude and Codex hooks do not imply
in-session model switching, and the project does not publish a quality or universal savings benchmark.

## Command Code evidence parity — 2026-09-20

The Command Code mod now writes planned rounds to the shared core `DecisionRecord` JSONL beside the
harness workspace, while preserving its existing custom entries. Tool identities are hashed with the
proxy convention; invalid usage and harness subscription prices remain unknown; log failures are
fail-open. The first host-served round is intentionally not recorded as a Sabi plan.

The Spec Kit-shaped VNext plan and ordered agent tasks are in
`docs/specs/adaptive-inference-scheduler-vnext.md` and
`docs/tasks/adaptive-inference-scheduler-vnext.md`. The next dependency is provenance/verification,
not a learned router or an unconditional Jev call.

Validation in this worktree: focused Command Code tests passed 15/15, full `npm test` passed 384/384,
and `npm run typecheck` passed. No provider request, secret, user configuration, deployment or
publication was performed.

## OpenCode Muse cheap-lane issue — 2026-09-20

The installed OpenCode 1.18.31 catalog exposes `opencode/muse-spark-1.3-contributor-free` with a
large context/output limit and a temporary free label. The current Sabi adaptive profile was not
actually context-short: it advertised 1,000,000 context tokens but fell back to 4,096 output tokens
because the proxy tiers had no declared output ceiling. The shipped config now declares the verified
OpenRouter minimum output ceiling (128,000), which the connector advertises for `sabi-code`.

Muse remains a deferred native lane. OpenCode's Muse endpoint is Responses-native; Sabi's proxy is
Chat Completions-only and cannot consume OpenCode's subscription credential. No Muse ID was added to
the proxy config, no user config or credential store was changed, and no paid inference ran. See
`docs/specs/opencode-muse-cheap-lane.md` and `docs/tasks/opencode-muse-cheap-lane.md`.## DeepSeek Harness bundle adapter — 2026-09-20

Added the public `@vizuh/sabi-deepseek-harness` DSH bundle. It adds a `sabi/sabi-code` route through
DSH's native `@deepseek-ai/dsh-llm-pi-ai` provider and attributes requests as `deepseek-harness`.
The controller inventory labels DSH `inference-only`; no lifecycle/controller capability is implied.

The package is pinned in documentation to DSH `0.1.6-alpha.2`, upstream revision
`ddefc45fbc7f8e46dd73185e68295696d1297887`. The local runtime did not include `dsh`, so the current
gate is package/patch/static validation only. A live DSH boot, stream receipt and mock-upstream probe
remain the next release gate. No secrets, paid inference or user configuration were used.

The source is merged in PR #47 at `09dc693`. Local npm publication was not possible because this
machine is not authenticated to npm. The follow-up `deepseek-harness-release` workflow publishes
with the repository's existing `NPM_TOKEN` and provenance on tag `dsh-v0.1.0`; registry presence and
the GitHub release remain to be verified after that tag run.

## DeepSeek Harness package publication verified — 2026-09-20

The release lane was merged in PR #48 at `e8ea222` and completed successfully in workflow run
`35526863398` on tag `dsh-v0.1.0`. The public npm packument now resolves
`@vizuh/sabi-deepseek-harness@0.1.0` with `latest: 0.1.0`; a clean install by package name passed,
and its tarball SHA-256 is `d229d80ac9e678f183f2582d09ed42292dc6b24eef3ae001c87551f4d92c484b`,
matching the GitHub Release asset. This verifies distribution, not a live DSH runtime: `dsh` is
still not installed on this host, so boot, stream receipt and proxy execution remain unverified.

## OpenRouter free quality lane — 2026-09-20

Added the opt-in `--free-quality` setup path to the controller and maintainer wizard. It refreshes
the live OpenRouter `/models` catalog, selects a generic zero-priced text/tool candidate, records
catalog provenance, writes `quality`/`sabi-quality`, and maps verification rounds to the fixed lane.
Paid tiers remain unchanged; plain setup remains offline. Command Code free-only registration
exposes the fixed quality lane but not `sabi-code` while its adaptive branches can spend paid
credits. A config backup is written once and no key value is stored.

Validation: `npm test` passed 393/393, `npm run typecheck` passed and `git diff --check` passed. The
live catalog on 2026-09-20 returned 446 models and 20 candidates under the selector; catalog SHA-256
was `902f62c1426fad7a3203a1485e034464651454e1ff35815098b66d8d771300ad`, and setup selected
`dots-studio/dots-3-note-preview:free`. A bounded direct free-only run covered four candidates and
12 synthetic rounds: 7 non-empty receipts, 4 empty choice shapes and 1 HTTP 429. A separate
temporary-config Sabi proxy run returned HTTP 200 with `SABI_PROXY_FREE_OK`; the decision was
`quality` → `dots-studio/dots-3-note-preview:free`, outcome `ok`, latency 1387 ms. These are
availability/receipt observations, not model-quality or privacy claims; no paid fallback or private
content was used.

Remaining gates: receipt-aware free-model health/demotion, a privacy-approved completed-task set,
held-out comparison, and only then any multi-model debate or learned quality profile.

## Surplus inference shadow QA — 2026-09-20

Added the first explicit surplus-inference slice on branch `feat/surplus-inference-shadow`. It
discovers fixed zero-cost text resources from config, builds a bounded tracked-diff packet, calls the
local `sabi-quality` proxy alias in shadow mode, parses bounded advisory claims and writes durable
metadata-only receipts to `SABI_SURPLUS_LOG` or the user Sabi config directory. Secret paths/markers,
adaptive aliases, tools, credentials and paid fallback are refused by construction.

Validation so far: `npm test` passed 400/400; seven focused tests pass and typecheck/diff check pass. This is not yet a live
completed-task quality result: claim verification, multi-resource fan-out, Jev intent assignment,
held-out evaluation and automatic handoff remain gated tasks.

## Surplus/free-quality review hardening — 2026-09-20

Follow-up work hardens the merged free-quality and surplus shadow paths. Surplus review input now
collects both endpoints of Git renames before applying the sensitive-path gate, and the gate covers
common credential filenames such as `.npmrc`, `credentials.json`, `secrets.yaml`, `token.txt` and
SSH key names without treating ordinary `tokens.ts` source as a secret file. Free-quality setup now
retains the catalog's `supported_parameters` in model capabilities, so strict compatibility can
prove the fixed `sabi-quality` request is dispatchable.

Validation in the follow-up worktree: focused tests passed 10/10, full `npm test` passed 401/401,
`npm run typecheck` passed and `git diff --check` passed. The PR is not yet merged; no provider
request, secret, user configuration, deployment or live quality result was used.

## Free-quality proxy parameter hardening — 2026-09-20

After PR #52 merged, review found that the generated catalog allowlist did not include Sabi's
proxy-injected `stream_options` field when OpenRouter `streamUsage` was enabled. The generated
quality model now adds that field conditionally, and a streaming fixed-lane route regression covers
the legacy compatibility path.

Validation in the follow-up worktree: focused free-quality tests pass; the full suite and remote CI
remain the delivery gates for the new PR. No provider request or live quality claim was used.

## Surplus council protocol and ledger — 2026-09-20

Added `docs/specs/surplus-council.md` and `docs/tasks/surplus-council.md`. The protocol defines
bounded `none`/`probe`/`panel`/`debate`/`council` modes, blind independent seats, conflict-only
cross-examination, a separate synthesizer when available, deterministic verification and explicit
egress limits. It is a contract, not an automatic council or quality claim.

Added `@sabi/core` council plan/ledger types and `sabi council history|record`. Receipts are
append-only JSONL with harness/runtime version/provider/model/stage/status/evidence/source and optional hashes,
counts and measured usage. Prompts, diffs, claims, provider output, credentials and transcripts are
excluded. `verifiedClaimCount` is forced to zero unless evidence is independently marked
`verification`.

OpenCode and Hermes execution remains the next adapter gate. Installed evidence observed for this
phase: OpenCode `1.18.31`; Hermes `v0.20.4` from the audited checkout launcher; Orca `1.4.201`.
No provider request or paid inference was used by the implementation.

## Council review receipts — 2026-09-20

After the implementation checks, two bounded read-only reviews were run as live harness
validation and recorded locally at `~/.config/sabi/council-ledger.jsonl`:

- OpenCode `1.18.31` / `opencode-zen` / `opencode/muse-spark-1.3-contributor-free`;
- Hermes `v0.21.3` / Nous / `upstage/solar-pro4:free`.

Both returned observable review responses with `status=completed` and `evidence=completion`.
Neither was independently verified, so both receipts retain `verifiedClaimCount=0`. This is
live review evidence, not evidence that Sabi automatically plans or delegates council seats;
the Phase 1–4 adapter and verifier gates remain open.

## OpenCode Muse cheap-lane issue — 2026-09-20

The installed OpenCode 1.18.31 catalog exposes `opencode/muse-spark-1.3-contributor-free` with a
large context/output limit and a temporary free label. The current Sabi adaptive profile was not
actually context-short: it advertised 1,000,000 context tokens but fell back to 4,096 output tokens
because the proxy tiers had no declared output ceiling. The shipped config now declares the verified
OpenRouter minimum output ceiling (128,000), which the connector advertises for `sabi-code`.

Muse remains a deferred native lane. OpenCode's Muse endpoint is Responses-native; Sabi's proxy is
Chat Completions-only and cannot consume OpenCode's subscription credential. No Muse ID was added to
the proxy config, no user config or credential store was changed, and no paid inference ran. See
`docs/specs/opencode-muse-cheap-lane.md` and `docs/tasks/opencode-muse-cheap-lane.md`.

## Hermes-first onboarding — 2026-09-20

The Hermes setup path now creates an isolated `HERMES_HOME` with the native attribution plugin, a
ready `config.yaml`, and a separate `sabi.config.json` pointed at the Hermes Nous proxy on
`127.0.0.1:8645`. It prints the Nous OAuth login and the three-terminal startup sequence. Jev, when
requested, is written only to that profile; the checkout's main config is untouched. No credentials
are copied into the profile or repository.

The user docs now include official Hermes installation, Nous login, OpenCode Go/ChatGPT Plus native
selection, and the explicit V1 boundary: those subscriptions are not provider-rebound into Sabi.
Model ids in the generated profile are catalog observations, not entitlement proof. The controller
package remains unpublished, so Hermes onboarding is checkout-based until a controller release exists.

Validation: `npm test` passed 384/384, `npm run typecheck` passed, the generated Hermes config passed
the pinned Hermes config check, and a Sabi health smoke passed on temporary port `18787`. No paid
provider request or external publication was performed.

## Hermes live smoke — 2026-09-20

The Orca validation tab has Hermes Agent `0.21.3` available with an isolated Nous profile. A bounded
real request completed as `Hermes (sabi-code) → Sabi :8789 → Hermes Nous proxy :8645 → Nous Portal`:
Hermes returned `NOUS_SABI_OK`, exit `0`, in `7378 ms`; Sabi recorded `client: hermes`,
`sessionKnown: true`, `alias: sabi-code`, `outcome: ok`, and `upstage/solar-pro4:free` upstream.
This proves transport, auth and attribution for one request only; it does not prove quality, quota,
entitlement, savings, paid spend or production readiness.

The local Qwen path has a hard compatibility limit on this host: `qwen2.5-coder:7b` exposes 32768
context tokens, below Hermes 0.21.3's 64000-token minimum. Use a local model with at least 64000
context or the Nous path for Hermes; keep Qwen on direct Sabi/Ollama until a larger-context local
model is selected.

The install/run instructions now include the exact `SABI_HERMES_BASE_URL` attribution boundary,
fresh-profile rule, three-terminal startup, native OpenCode Go/ChatGPT Plus boundary, and this
Qwen limitation. Temporary validation servers and the proxy were stopped after the receipt was
captured; the existing Hermes profile and checkout worktree were preserved.

## Public package release — 2026-09-20

PR [#54](https://github.com/vizuh/sabi/pull/54) merged at `9cb67626e977c5b9afba452e1d3b47966659967`.
Tags `v0.1.3` and `controller-v0.1.0` completed their release workflows successfully:
[Command Code workflow](https://github.com/vizuh/sabi/actions/runs/35539333133) and
[controller workflow](https://github.com/vizuh/sabi/actions/runs/35539332925). The public npm
packuments now resolve [`@vizuh/sabi@0.1.3`](https://www.npmjs.com/package/@vizuh/sabi/v/0.1.3)
and [`@vizuh/sabi-controller@0.1.0`](https://www.npmjs.com/package/@vizuh/sabi-controller/v/0.1.0);
the matching GitHub assets are attached to the
[`v0.1.3`](https://github.com/vizuh/sabi/releases/tag/v0.1.3) and
[`controller-v0.1.0`](https://github.com/vizuh/sabi/releases/tag/controller-v0.1.0) releases.

This proves source, CI, package build and public distribution. It does not prove universal host
activation, cross-terminal completion, provider entitlement, quota behavior or task quality; those
remain runtime evidence gates.

## Portuguese user-facing onboarding — 2026-09-20

Added `docs/install.ai.pt-BR.md` as the Portuguese host-AI runbook and linked it from the Portuguese
README and installation guide. The English runbooks now expose the pt-BR language switch. The
translated surface covers the primary Hermes path, OpenRouter-only proxy credential collection,
native OpenCode Go/ChatGPT Plus boundaries, BYOK guidance and layered completion checks. Internal
architecture, decision and research documents remain English unless a user-facing translation is
needed.

The Portuguese adapter navigation now includes a localized index and Hermes guide, while package
implementation READMEs remain English developer references.

## Full-repo security review — 2026-09-21

Four independent passes (two live model reviews — OpenCode/Muse free tier, OpenCode-Go/DeepSeek
paid with user-authorized spend — plus two Claude verification/coverage subagents) audited the
whole repo against an injection/auth/data-exposure/dependency/crypto checklist. Full writeup:
`docs/reviews/security-review-2026-09-21.md`. New `docs/security.md` documents the current
authentication, authorization, encryption, audit-logging and incident-response posture honestly,
including the gaps that weren't fixed.

Fixed: Orca dispatch control-character injection (HIGH — newline in a dispatched request could
execute as multiple terminal commands), daemon token printed by `--json`, setup wizard's
Jev-off message not matching what it wrote, decision/council/surplus log file permissions,
non-constant-time daemon token compare, unquoted `SABI_HOOK_COMMAND`. Left open and documented:
the inference proxy has no authentication (a product decision, not a hardening patch — it changes
every adapter's connection contract), `SABI_DSH_BASE_URL` validation (no Sabi-authored runtime
code exists in the DSH bundle to hook it into), the unsalted tool-name hash, and a narrow
`saveOpenRouterKey` TOCTOU window.

Merged to `main` via PR from `security/full-repo-review`. Next agent: get an answer on whether
Orca's `sabi.dispatch` is reachable by non-human callers (determines real severity of the fixed
HIGH finding), then decide the proxy-auth design before anyone builds on the assumption the local
proxy is a trust boundary — #60 below (merged separately, in flight while this branch was open)
adds an origin/Host/Referer check that closes real DNS-rebinding/CSRF exposure but is not
authentication: it does not stop another local process, or a remote client that simply sets a
loopback-looking `Host` header, from calling `/v1/chat/completions` or `/decisions` with zero
credential. The gap this review flagged is narrower than it was, not closed.

## Privacy/egress hardening (#59 #60 #67 #68) — 2026-09-21

Implemented in this worktree (`muse/privacy-egress`, local only, not pushed): judge state is
content-free by default with an explicit `judge.includeSnippets` opt-in; the loopback proxy
rejects non-loopback Host/Origin/Referer and non-JSON chat bodies and no longer leaks the log
path from `/healthz`; the proxy route derives a declared-only context window and a
session-memory stuck streak (unattributed requests: window at most); clean EOF without `[DONE]`
completes with usage, mid-stream failures end with an SSE error frame, and non-UTF-8 error
bodies keep their 429/`transport` classification.

Validation: `npm test` 445/445, `npm run typecheck` clean, `git diff --check` clean. No paid
request, secret, user config, publication or deployment. See `log.md` and `docs/decisions.md`
for the dated entries.

## CI gate and pt-BR doc drift (#63, #64) — 2026-09-21

Closed issues #63 (CI `paths` filter skipped `packages/server`, remaining adapters, `evals`,
`scripts`) and #64 (pt-BR README/install drift) in this worktree. `controller-ci.yml` no longer
filters by path, so every PR and main push runs the full gate. `sabi setup --hooks` is a
recognized explicit setup alias again (`--no-hooks` wins on conflict); the pt-BR verify block
drops the stale test count, the service sentence separates code-exists from real-machine
validation, the `Planejado:` line no longer contradicts the structure list, and the pt-BR
OpenCode modalities paragraph describes the code derivation like the EN guide. Full details in
`log.md`.

Validation: focused `cli.test.ts` 17/17, `npm test` 476/476, `npm run typecheck` clean,
`git diff --check` clean, workflow YAML parses. No paid request, secret, user configuration,
deployment or publication. Not pushed.

## Public 0.1.4 release — 2026-09-21

`@vizuh/sabi@0.1.4` is published (PR #84, tag `v0.1.4`, workflow `35580099282`, GitHub Release
with the served tarball). It ships opt-in transport fallback (429/402/403 retry on adaptive
rounds only when enabled; shipped off; 7 new tests) and the intent-gated surplus council spec;
`sabi-free` was deferred for lack of a verifiable free id. Registry and tarball verified live.
No controller tag (unchanged since `controller-v0.1.0`). Checkout is on `main`; the
`release/0.1.4` branch and the `docs/ptbr-adapter-guides` stash `release-0.1.4 working tree`
(superseded port sources) remain until Hugo prunes them.

## Evidence-aware scheduler vNext — 2026-09-21

The feature branch `feat/evidence-aware-scheduler-vnext` is rebased onto the current
`origin/main` (`294b474`). It adds the Spec Kit contract and an additive foundation for
evidence provenance, generation-bound verification, deterministic recovery actions, bounded
controller capsules, shadow semantic profiles, fixture-only replay, and PRE/LIVE/POST eval labels.

The merge surface preserves the 0.1.4 cost-ordered fallback, transport fallback, model health,
and content-free judge egress. Raw judge snippets remain opt-in; capsule labels drop secret-like
content; decision-log persistence uses an allowlisted projection rather than serializing unknown
properties.

This is not a claim of live quality improvement or automatic learned routing. Live provider
receipts, external harness capsule consumption, durable profile learning, candidate promotion,
and deployment remain follow-up work tracked in GitHub issues from the review PR.

## Hermes setup metadata annotation — 2026-09-22

The Hermes setup wizard now inspects an existing `HERMES_HOME/config.yaml`
(and the conventional `~/.hermes/config.yaml`) for numeric
`context_length`/`context_window` capacity and `lcm` context-engine signals,
then writes those observations as informational comments in the newly generated
isolated `config.yaml`. Comments preserve Hermes' schema and do not turn local
profile observations into routing, entitlement or quality evidence.

Added unit and end-to-end setup coverage for anchored capacity, LCM metadata and
generated-profile annotation. This PR is intentionally based on `origin/main`;
the unrelated closed PR #92 branch history is not included.

Validation: focused setup tests and the full repository suite pass with
`TMPDIR=/tmp`; `npm run typecheck` and `git diff --check` pass. No credentials,
live provider request, user profile mutation, deployment, commit or push.

## OMP output ceiling, and the pre-upgrade check — 2026-09-23

OMP requests `max_completion_tokens: 64000` per round; the adaptive alias planned `cheap`
(`maxOutputTokens: 32768`) and Sabi returned `400 incompatible route 'cheap': output token limit
exceeds maxOutputTokens`, stalling the OMP session. Requested output is now a hard constraint: the
planned tier is skipped for the cheapest tier that declares enough (`rule: output-capacity`), and a
substitute must *declare* that capacity, so an undeclared ceiling cannot win the promotion.

`sabi updates [--check] [--json]` is the new pre-upgrade check: npm version for
`@vizuh/sabi-controller` (24h-cached, offline unless `--check`) plus a preflight of Node, project
config and installed hook paths, with the upgrade warning attached when the registry is ahead.

Validated: full suite 590/590, typecheck clean; both captured OMP bodies replay to `mid`; the live
server was restarted (it predated the fix) and the exact rejected body now returns 200 with
`rule: output-capacity, tier: mid` in the decision log. `sabi updates` found a real stale Claude
hook pointing at the deleted `worktrees/sabi/release-free-first` checkout — repair with
`sabi hooks install`. The installed `~/.omp/agent/extensions/sabi.ts` was resynced from the repo
source. Not pushed: the work is in the working tree only.
