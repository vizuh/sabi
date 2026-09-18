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

---

## [2026-09-18] Distribution: clone + local install, no hosted service, plan-safe tiers

### Decision
Sabi is delivered as code other people run locally, from this private repo. The supported install is `git clone` + `npm install` + `cmd mods add ./packages/adapters/command-code`; the package declares what it ships with `{"commandcode": {"mods": ["./mod/sabi.ts"]}}`. Nothing is published (no npm, no tarball) and nothing is hosted. `sabi.config.json` is now discovered in a fixed order — `$SABI_CONFIG` alone when set, then `<cwd>`, then `~/.config/sabi/`, then the nearest config above the installed package — so a fresh clone works unmodified while an individual can still override per project or per user. `harness.tiers` defaults are restricted to ids covered by the **Go** plan.

### Why
- A hosted Sabi could not route the Command Code catalog at all (see the class decision above): the BYOK surface is inbound-only, so a server-side Sabi would be a BYOK relay — the weakest half of the product — while taking custody of other people's keys and putting one shared point of failure in every user's loop.
- npm publishing is not available for a private repo, and the mod depends on `@sabi/core`, a workspace package: a registry install would need both published or a bundle step. A clone plus a local source needs neither — jiti compiles the TypeScript at load and the workspace link resolves `@sabi/core`.
- Without the search order, `loadConfig()` resolved `sabi.config.json` from the core package's own location (`new URL('../../../', import.meta.url)`), which is correct inside this repo and nonsense from any other project — the mod would simply refuse to load anywhere else.
- The tier defaults previously named `claude-sonnet-5` (Pro) and `claude-opus-5` (Max). Verified live on this account: an out-of-plan model fails the round with `403 MODEL_NOT_IN_PLAN: … available in Pro and above plans`, and `cmd --list-models` prints the whole catalog regardless of plan — a plausible-looking list is not evidence of usability. Defaults must work from Go up; the Pro/Max table lives in the docs.

### Alternatives considered
- A hosted control plane (policy, config, telemetry — not inference) — deferred, not rejected; it is the right shape if policy freshness or team accounting ever justifies it, and it sidesteps key custody.
- Publishing `@sabi/core` and the adapter to npm — blocked by the private-repo decision; revisit if the product goes public.
- Installing through `cmd mods add vizuh/sabi` (git shorthand) — untested; this is a monorepo, so a git source gets the repo root rather than the adapter package.
- Shipping a tarball — rejected; it would carry the adapter without its `@sabi/core` dependency.
- Bundling core into the mod to make it self-contained — deferred; it removes the workspace dependency but adds a build step to an otherwise build-less mod.

### Tradeoffs
- Every user needs read access to the private repo, and the clone must stay in place (a local source is referenced, not copied).
- The shipped tiers are deliberately not the strongest models a Max account could use.
- `sabi.config.json` is the product surface, and users are expected to edit it.

### Revisit later?
If someone needs Sabi without a clone, that is the trigger to publish `@sabi/core` + a bundled mod, or to build the small control plane.

---

## [2026-09-18] Content-free telemetry, repeated-failure and context rules

### Decision
Decision records carry **allowlisted evidence codes only** by default (`telemetry.allowlistOnly: true`); raw tool-output excerpts and provider error bodies are opt-in (`telemetry.captureSnippets`) and never the default. `TrajectoryState` gains `repeatedFailure`/`failureStreak` and `contextTokens`/`contextKnown`/`contextWindow`; the deterministic router adds `stuck` (repeated failures route to a configured stuck tier instead of escalating forever) and `context-pressure` (prefer a big-window model near limits, only when the window is known). Routes stay deterministic; "unknown" stays unknown.

### Why
The telemetry finding was the only *critical* one in the folder review: `snippet()` embedded tool output and `policy.ts` put it in reasons. Replacing excerpts with codes keeps the routing signal (the failure *kind* is what drove the rule) while making the "never prompt content" claim true. The repeated-failure rule addresses the review's "repeated failures trigger investigation, not endless escalation" — and it must precede `failure` in the policy order, since a repeated failure is also a hard failure. Context pressure only fires when `contextWindow` is known; an unknown window can never pick a smaller model by guess.

### Alternatives considered
- Keep raw excerpts but strip them before export — rejected; the review's acceptance check wanted the default to be content-free, not a post-hoc redaction step.
- Add a Jev judgment for stuck detection — rejected for now; deterministic `repeatedFailure` is cheaper and the review asked for semantics only where measured.
- Escalate on repeated failures (stuck → strong) — rejected; the review explicitly named investigation over escalation.

### Tradeoffs
- Evidence codes lose the exact failing text, so tuning `HARD_PATTERNS` now needs a replay fixture that reproduces the class, not the snippet.
- `stuck` and `context-pressure` add two policy keys; default config sets both (`stuck: mid`, `context-pressure: mid`) so behavior is explicit.

### Revisit later?
Tune `stuck`/`context-pressure` thresholds from real sessions; add a Jev question for root-cause only if deterministic detection misses cases measured in evals.

---

## [2026-09-18] Offline evals first + transport is not task failure

### Decision
Sabi gets a dependency-free offline eval harness (`packages/evals`): a frozen task set is replayed through the deterministic router at tool-result boundaries and compared against a fixed eligible baseline tier, reporting task pass/fail/blocked, routing, cost and quality gates. Separately, `transport` becomes a distinct `FailureLevel` (`rate-limited`/`quota-exceeded`/`timeout` evidence codes): a 429/rate-limit/timeout — from a tool result or an upstream 429/5xx — routes to the `transport` policy tier (default `mid`) and is recorded as `outcome: 'transport'`, never escalating to strong.

### Why
The competitive scorecard's core finding: Sabi had no evidence it completes tasks more cheaply or reliably, and `packages/evals` was absent. The offline harness answers "compare task outcomes, not token repricing" without paid calls. The router-learnings' mechanism #7 ("A 429 is not classified as a reasoning failure") is a concrete planner gap: a rate-limited upstream call or a tool whose output shows a quota error was being treated as a hard failure and escalated — the opposite of correct handling.

### Alternatives considered
- Build the eval against the live proxy — rejected; paid calls, non-deterministic, and the scorecard explicitly wanted a frozen offline comparison first.
- Treat 429 as soft — rejected; soft requires two signals and the learnings were explicit that transport is distinct, not "soft failure".
- Reuse the Jev client's 429 retry for the main upstream too — deferred; the mod path has no Jev, and the transport *classification* is the invariant that helps both paths. Provider-side retry can layer on later.

### Tradeoffs
- The eval's negative-savings finding (deterministic policy over-escalates without Jev) is honest but means the offline number is not the live number; the harness labels it an offline repricing estimate.
- `transport` adds a policy key and a FailureLevel; the config sets it (`transport: mid`) so behavior is explicit and auditable.

### Revisit later?
Wire Jev or the upstream retry into the eval replay once a fixed-policy baseline task set is stable; add more transport signals (e.g. 402 quota, provider 429 bodies) after real 429s are observed.

---

## [2026-09-18] Media is a routing constraint, not a post-hoc validation

### Decision
Input modality joins the state Sabi routes on. `TrajectoryState` gains `inputModalities` and `mediaCounts`, extracted from the request's content parts (including nested tool-result content); every model tier can declare what it accepts (`models[].capabilities.inputModalities` on the proxy, `harness.tiers[].inputModalities` on the mod). When the policy's chosen tier cannot accept what the round carries, the adaptive path serves it from the first tier in configuration order that can, and records `rule: capability`. A fixed alias does not upgrade — it refuses with a 400 naming the modality. When no tier can serve it, the proxy refuses and the mod leaves the round on the session model. Images are charged 1500 tokens each in the context estimate, mirroring the host's own per-image bound; other media are charged by payload size.

### Why
Verified from the proxy's own decision log (2026-09-18): 8 of 12 recorded errors were the same upstream failure — `No endpoints found that support image input` (OpenRouter 404, `failed_routing_step: Filter by Image Support`) — every one of them routed to cheap → `deepseek/deepseek-v4-flash-0731`, the tier that serves most rounds. The router had no notion of modality, and the compatibility gate could not help because no capabilities were declared: `ensureRouteCompatible` enforces declared values only, so an undeclared modality is unknown and passes. The same screenshot behaves differently per class, which is why it read as "sometimes" broken: the proxy forwards the image and the upstream 404s, while the harness strips images for a text-only model and the round silently answers blind. Both are failures; only one is visible.

### Alternatives considered
- Declaring `capabilities` alone and letting `ensureRouteCompatible` reject — rejected as the whole fix; it converts a confusing upstream 404 into a clear refusal but still fails the round. Declared capabilities remain the backstop, and the routing constraint is what makes the round succeed.
- Counting base64 bytes as text tokens — rejected; providers tokenize a decoded image by resolution, and 400 KB of base64 became ~111k phantom tokens in a measured test. The host charges 1500 per image; mirroring it keeps Sabi's estimate comparable with the host's.
- Detecting media for the mod from a host API — none exists (`cmd.ui.capabilities` exposes only `.status`). The scan mirrors the host's own predicate (`content.some(part => part.type === 'image')`), widened to every role and to nested tool-result content, and reports positive evidence only.
- Making tier order explicit in config — rejected; declaration order already is the preference order, so cheap-before-strong sorts itself.

### Tradeoffs
- A fixed alias can now fail where it previously failed anyway, but earlier and with a clearer message; `sabi-cheap` is a baseline and stays a baseline.
- Media detection on the mod path is best-effort against an undocumented transcript shape; a transcript it cannot read yields no modalities, which leaves routing as it was rather than inventing a constraint.
- The per-image bound is a bound, not a measurement: a very large image is undercounted, and a remote URL is charged only its URL length.
- Rejected routes are not written to the decision log — the refusal happens before a record exists, so the log shows successful rounds only.

### Revisit later?
Per-harness media shapes (Prime Agent, OpenCode, Hermes) should reuse `tallyMedia` once their transcript formats are verified; consider logging refused routes for operator visibility; refresh `inputModalities` from the upstream API whenever model ids are refreshed.

---

## [2026-09-18] Consent gate for the proxy path: per-upstream kill switch plus a paid/free question at wiring time

### Decision
`upstreams.<name>.enabled` joins the schema (`UpstreamEntry.enabled?: boolean`, omitted or `true` means usable). It is enforced twice: `connect.ts` will not register a Command Code alias whose only reachable tiers sit behind a disabled upstream, and `ensureRouteCompatible` refuses to dispatch to a disabled upstream at request time regardless of what registered it. `connect.ts` also gained an explicit paid/free question before it registers anything paid-backed: `--paid`/`--free` decide it outright, otherwise it prompts on a real TTY and defaults to **free** when non-interactive (never blocks a CI/agent-driven run on stdin). The kill switch overrides consent — a disabled upstream stays absent even with `--paid`.

### Why
Class B (the proxy) registered every paid-backed alias in `~/.commandcode/providers.json` unconditionally, with no consent step and no way to turn an upstream off short of hand-editing `sabi.config.json` and restarting. A session pointed at `sabi/sabi-code` this way spent real OpenRouter credit with no warning. Class A (the mod) was and remains unaffected — it never reads `upstreams`/`models` at all — but nothing stopped Class B from being the thing that got wired in by default, and once wired, disabling it required editing JSON with no immediate effect on a request already in flight against the running proxy.

### Alternatives considered
- A separate `setup.ts` wizard — rejected; the consent question is one yes/no in front of the existing writer, not a new entry point, new npm script or new doc section to maintain.
- Normalizing `enabled` to a filled default at config-validation time — rejected; every consumer already needs only a two-way `!== false` check, and a normalization pass earns its keep only once a second consumer needs a definite boolean, which none does yet.
- Shipping `sabi.config.json`'s `openrouter` upstream `enabled: false` by default — rejected; it would silently break the documented Path B walkthrough (`docs/install.md`) and `npm run eval`'s dependency on the real shipped config, for no gain over the actual fix (the consent step plus the dispatch guard already stop the unattended spend).
- Enforcing the kill switch only at `connect.ts` registration time — rejected; a stale registration, a direct request, or another harness's config pointed at the same running proxy would still reach a disabled upstream. `ensureRouteCompatible` is the one choke point every dispatch path goes through (fixed alias, adaptive, and the post-judge revalidation in `server.ts`), so the guard lives there too.

### Tradeoffs
- A non-interactive `connect:command-code` run now needs `--paid` to reproduce the old unconditional registration — a deliberate, documented behavior change (`docs/install.md`, `docs/install.pt-BR.md`).
- The consent question and the kill switch are Command Code (Class B) concerns only in this change; Hermes/OpenCode/Kilo still rely on manually following `docs/harnesses.md`, and a self-service "add a model" flow does not exist yet.

### Revisit later?
Each of Hermes/OpenCode/Kilo needs its own consent branch before Sabi is wired into them by anything beyond `docs/harnesses.md`'s manual recipes. A self-service "add a model" flow needs a real fetch against the provider's live models endpoint (never hand-typed pricing/context, per the no-invented-facts rule) plus a plan-verification step equivalent to what `harness.tiers` already gets right for Class A — neither is built here; `enabled` and the paid/free split are shaped so that work extends them rather than replacing them.

---

## [2026-09-18] Correction: the repo is public; the npm-publishing blocker from the distribution decision no longer holds

### Decision
`github.com/vizuh/sabi` is public (confirmed live via `gh repo view` — `"isPrivate":false`), not private. `AGENTS.md` and `docs/context.md` said "private" and were stale; corrected. This does **not** change the distribution decision above (clone + local install) — it removes one premise of its reasoning, not the decision itself. Still not building: a signed-update daemon, a hosted model/routing-registry server, or an auto-updater (`router update`/`rollback`/`doctor`-style tooling proposed this session). No change to `sabi.config.json`'s discovery order or the install docs.

### Why
The original entry's first "why" bullet was "npm publishing is not available for a private repo." That's now false — the repo being public means `npm publish` (or a GitHub-Release-based install) is mechanically possible today. But visibility and *need* are different facts: this repo has one user (Hugo, this machine) and zero external installs to manage. The proposed daemon/updater/hosted-registry stack solves a distribution-at-scale problem — versioning a running service for people who aren't the maintainer — that doesn't exist yet. Building release infrastructure, a CDN/version endpoint, and a rollback story for zero current external installs is exactly the "speculative abstraction" this repo's own working style rejects elsewhere.

### Alternatives considered
- Build the full proposal now (daemon, signed releases, `router update`, hosted routing-registry) — rejected for now; no external user to serve, and it reopens key-custody/hosting tradeoffs the original distribution decision deliberately avoided.
- Do nothing, leave the stale "private" claims uncorrected — rejected; they're simply wrong and would mislead the next reader into thinking npm publishing is blocked when it isn't.
- Publish `@sabi/core` to npm right now, since it's newly possible — not decided here; no consumer has asked for install-without-clone yet, which is this repo's own stated trigger (below) for that step specifically.

### Tradeoffs
None from the correction itself. Deferring the daemon/registry proposal means Hermes/OpenCode/Kilo users (if any appear) still follow the manual recipes in `docs/harnesses.md` until a real need for centralized distribution shows up.

### Revisit later?
Genuinely good idea worth keeping, not building yet: separating update cadence by layer (runtime binary version, changes rarely; model/routing registry, could change daily; skills, versioned independently) — if Sabi ever does need a registry-fed routing manifest, that three-layer split is the right shape, not a single version number for everything. The concrete trigger for `npm publish` specifically (not the daemon) is unchanged from the earlier entry: someone other than Hugo asking to install Sabi without cloning this repo.

---

## [2026-09-18] Context measurement and compaction invalidation: billed usage, a generation boundary, and a shadow judge question

### Decision
- `contextTokens` means measured: the provider's billed usage for the previous round of the same session, floored at the character estimate. `applyMeasuredContext` sets `contextKnown` only from that path — a character estimate is never promoted to a measured size. The proxy keeps bounded per-session memory (identified sessions only, 512 entries) filled from tapped usage; the mod fills its ledger from the host's `usage`.
- A transcript that comes back below half its previous message count is a host compaction: `state.contextGeneration` advances and the repeated-failure streak restarts. The generation is part of the judge request state, so the judge cache key changes across the boundary by construction.
- A third Jev question (`evidence_redundant`) rides the existing batched request in shadow mode: read leniently, recorded as `judge.evidenceRedundant`, counted by `npm run report`, never applied to a route, threshold or transcript.
- The offline eval gains `EvalTask.compactedAfterRound` and a `compaction-reset` task.

### Why
- The proxy declared context unknown while its estimate ignored tool schemas; the mod accumulated only tool-output length. Neither path could fire `context-pressure`, and a compaction would leave both a stale size and a stale judged verdict in place.
- Jev does not judge consistently across sessions — the jev-compaction project measured `write_file` kept in one session and dropped in another, and its fix was code-level policy (`PROTECTED_TOOLS`), not a better prompt. Any future context-selection verdict needs the same discipline: policy-gated, measured before trusted. A shadow question is that measurement.
- Invalidation must be structural, not incidental. The judge cache key already hashes the judge state object, so putting the generation into that object is cheaper and more reliable than adding a second key dimension in the client.

### Alternatives considered
- Inferring context size from characters and marking it known — rejected: tool schemas and framing are not tokens, and an unmeasured fit must stay unknown.
- Carrying the measured size across a detected compaction — rejected: it describes a context the host has removed.
- Carrying the failure streak across a rewrite — rejected: after the rewrite the earlier failure is not the attempt the model is continuing.
- Reusing jev-compaction's mechanism (judge-driven drops and truncation) — rejected: the host owns compaction and two summarizers corrupt state; only the routing signal is borrowed, and Sabi rewrites nothing.
- Failing the judge call on a missing shadow answer — rejected: a measurement-only question must never take the applied judgment down.

### Tradeoffs
- The boundary detector is a heuristic (half the message count, floor of 8, identified sessions only). It can miss a small compaction and can treat a reused session id as a rewrite; both are bounded — the worst case is one restarted streak and one extra cache miss.
- The shadow question adds a few output tokens per judged call. It is unverified until it has run on real traffic.

### Revisit later?
Re-check the thresholds after one real compaction; decide whether the shadow answer predicts anything (the report counts it) before any context-selection work; note that the mod still has no judge path, so a Class A shadow answer cannot exist until the mod can call Jev at all.
