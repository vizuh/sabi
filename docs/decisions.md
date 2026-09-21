# Decisions Log

Record only meaningful decisions: what, why, tradeoffs, what to revisit. Template: `www/_shared/templates/workflow/docs/decisions.md`.

---

## [2026-09-18] Product name and namespace: Sabi under vizuh/sabi

### Decision
Product name is **Sabi**; the repository lives at `github.com/vizuh/sabi` (private).

### Why
`sabi` and `uasabi` GitHub handles are taken. Keeping the brand short and hosting it under the existing Vizuh namespace beats weakening the name to fit a handle.

### Alternatives considered
- Rename the product to fit an available handle — rejected; the name is the brand.
- Wait for a dedicated org handle — blocked; candidate handles are taken.

### Tradeoffs
- Repo owner reads "vizuh", not "sabi"; a later move to a dedicated org changes the URL.

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

---

## [2026-09-18] One setup command instead of three manual procedures

### Decision
`scripts/setup.ts` (`npm run setup`) asks which harness (Command Code / OpenCode / Hermes) and, independently, whether to enable Jev, then dispatches to the harness-specific path. It does not replace the detailed per-harness sections in `docs/install.md` — it runs the same writers those sections document (Command Code, OpenCode) or automates the mechanical parts of a still-uncertified manual recipe (Hermes), and always defers to `docs/harnesses.md` for Kilo/Prime Agent rather than attempting to automate paths that have no writer at all.

### Why
Wiring Sabi in was three unrelated procedures with no common entry point, and turning on Jev was a fourth, separate manual step (export a key, hand-edit `sabi.config.json`). None of that changed technically this session — this is packaging, not new routing behavior.

### Alternatives considered
- A single `resolveChoice<T>` combinator generalized across the harness pick (3-way, no safe default) and the yes/no questions (Jev, paid/free) — rejected; the harness pick's "no flag + non-TTY = fail, don't guess" behavior is different enough from the yes/no questions' "fall back to the safe answer" that forcing one generic shape produced more branching than two small, honest functions (`resolveHarness`, `resolveYesNo`).
- Importing `opencode/connect.ts` directly instead of spawning it — rejected; that file reads `process.argv`/`process.env` at module scope regardless of any main-guard, so importing it would never be side-effect-free. Spawning is the only option and is already the pattern its own test suite uses.
- Auto-filling Hermes's `REPLACE_WITH_VERIFIED_CONTEXT_TOKENS` placeholder with the computed candidate (`minContextWindowFor(config, 'auto')`) — rejected; the number is mechanically correct but nobody has looked at it yet, and the Hermes recipe's own stance is that this value needs operator verification. The wizard prints the candidate and leaves the placeholder in the written file.

### Tradeoffs
- Jev is proxy-only (Class B / OpenCode / Hermes); the question is skipped for Command Code Class A specifically so a "no" or "yes" answer there never contradicts Class A's own "nothing written by this wizard" message.
- `enableJev`/`setJevEnabled` needed to actively write `false`, not just skip writing on decline — the shipped `sabi.config.json` ships `judge.enabled: true`, so a no-op on decline would have silently ignored the user's answer. Caught in review, not in the original design.
- The Hermes branch is new, uncertified code automating an already-uncertified manual recipe — it does not make that path more certified, just faster to attempt.

### Revisit later?
If Hermes ever gets a real certified run against Sabi, revisit whether the context-token candidate should become an assertion instead of a printed suggestion. Kilo/Prime Agent stay recipe-only until either gets its own writer.
## [2026-09-18] Publish the mod to npm as one bundled package (@vizuh/sabi), tag-driven

### Decision
Ship the Command Code mod as `@vizuh/sabi`: `packages/adapters/command-code/pack.mjs` bundles `mod/sabi.ts` and its `@sabi/core` imports into a single `mod/sabi.mjs` (esbuild, dev-only), copies the repository's default `sabi.config.json` beside it, and writes a publish manifest into the gitignored `pkg/`. `.github/workflows/release.yml` publishes that directory on a `v*` tag with provenance. The repository source stays the install source for a clone (referenced in place, auto-updating on `git pull`); only the npm artifact is bundled. The proxy path is not published.

### Why
The trigger recorded when this was deferred — "someone other than Hugo asking to install Sabi without cloning" — has been met by Hugo asking: distribution should not require a clone, git history or a dev toolchain. Command Code installs npm packages with `--ignore-scripts`, jiti-loads the manifest's entry, and never runs npm/git at session start, so the supported shape is one self-contained file plus `cmd mods update` as the update step.

### Alternatives considered
- Publish both workspace packages unbuilt (`@sabi/core` + adapter) — rejected: it depends on the harness transpiling `.ts` dependencies inside `node_modules` (unverified), and doubles the publishing surface and the failure modes.
- Publish from git only (`cmd mods add -g vizuh/sabi`) — rejected: the mod lives in a subdirectory, the package manifest convention has no subpath form, and there would be no versioned dist-tag for users to update against.
- Auto-update at session start — rejected: Command Code deliberately never runs npm/git at startup, and auto-installing from a registry on every start is a supply-chain decision, not a convenience default. A notify-only version check remains the follow-up if users need it.

### Tradeoffs
- Publishing needs an npm org and a token: the `@vizuh` scope must exist and the repository needs an `NPM_TOKEN` secret; nothing publishes until a `v*` tag is pushed.
- The bundle is a snapshot of `packages/core` taken at pack time; it is regenerated per release from the same source, and its version follows the tag, so drift is bounded to release cadence.
- No LICENSE file exists in this repository, so the published manifest declares no license (all rights reserved by default) — add one before inviting outside use.

### Revisit later?
Whether to publish `@sabi/core` for proxy-path users; whether the mod should notify about newer dist-tags; and the open defect this work surfaced — a mod-planned `zai-org/glm-5.3` (the shipped `strong` tier) fails with `403 Model/provider not recognized`, while the same id works as a session model in both casings (repro in `docs/handoff.md`).

---

## [2026-09-18] Local recovery-rate tie-breaker for Jev's ambiguous branch

### Decision
`packages/core/src/recovery.ts` computes, from this machine's own `.sabi/decisions.jsonl` (zero new capture), a per-`(tier, upstreamModel)` recovery rate: a round whose `state.failure === 'hard'` (the same signal that puts a round in the `failure` policy rule) credited with a recovery if the *next* round in the same session comes back with `failure: 'none'`, gated on a one-sided 95% Wilson interval and a hard `n ≥ 30` minimum sample. `applyJudge()` (`packages/core/src/judge.ts`) takes this as an optional 4th `profile` parameter and consults it in exactly one place — the existing ambiguous `else` branch of the `failure` rule, where `realProblem` is between the veto and confirm floors and today's code just keeps the deterministic escalation. The escalation is declined only when the candidate's worst-credible rate (Wilson lower) exceeds the incumbent's best-credible rate (Wilson upper) — a non-overlapping-confidence-interval test, not a point-estimate comparison. `packages/server/src/server.ts` loads the profile once at server startup, never inside a request.

### Why
The user wants routing weighed against something like `U(model,task) = P(success)·value − token_cost − latency_cost − P(failure)·retry_cost`, estimated from local history, not an invented/pasted benchmark table. Checked first, not assumed: no task/round success signal exists anywhere in this codebase today — `DecisionRecord.outcome` is transport-level only (did the HTTP round complete), and `packages/evals`'s `pass`/`fail` is a hand-typed label on a frozen fixture with zero connection to real logs. Building the full formula now would mean inventing `value`, `C_latency`, `C_retry` — exactly what "no invented facts" (`AGENTS.md`) forbids. `failure`, already logged and already privacy-cleared, gives a genuine, zero-new-capture proxy for `P(success)` alone: this machine already has 550 real decision rows to compute it from.

**Found and fixed on code review, before this landed** (the first draft used `state.failureStreak > 0` as the trigger — the review caught that this was structurally dead code): `extractTrajectoryState()` (`state.ts`) hardcodes `failureStreak: 0`/`repeatedFailure: false` unconditionally — the proxy is stateless across requests and never tracks a cross-round streak; only the Class A mod (`harness.ts`) computes a real streak, and the mod never calls Jev. So the trigger became `state.failure === 'hard'` instead — the signal the proxy *does* compute correctly per round, and the one that put the round in the `failure` rule to begin with. Also fixed: the pairing loop pre-filtered to `outcome === 'ok'` rows *before* checking adjacency, which silently collapsed an intervening `error`/`aborted` round and let two non-consecutive rounds get paired — now both sides of a pair must individually be `'ok'`, or the pair is skipped, not the sequence collapsed. Also fixed: `retier()`'s own availability/capability fallback could in principle substitute a tier stronger than the incumbent, which would have mislabeled an escalation as a "decline" — `applyJudge()` now checks the tier that actually served before claiming a decline. Also fixed: the fallback's resolved rule can be `'unclassified'`, which would re-trigger the difficulty-override block a few lines later and silently overwrite the decline — guarded with an explicit flag. Also fixed: the comparison was `candidate.wilsonLower > incumbent.pHat` (asymmetric — never discounted the incumbent's own sampling noise); now both sides go through the same bound, via one shared `candidateBeatsIncumbent()` predicate `judge.ts` and `backtest.ts` both call, instead of two hand-copies that could drift apart. Also fixed: `packages/server/src/server.ts` loaded the profile lazily inside the same `try` block as the judge call, so a read failure would have been misattributed to a Jev outage, and did a synchronous whole-file read inline in a request handler; moved to server construction, before any request is accepted. Also fixed: `backtest.ts` reconstructed a `tier::upstreamModel` key and split it on `::`, which would silently corrupt on a model id containing that substring — replaced with `recoveryPairs()`, which decodes without ever re-splitting a hand-built string.

### Alternatives considered
- The full `U(m,t)` formula — rejected for now; no verified local source for `value`, `C_latency`, or `C_retry`. Recovery rate is deliberately the smallest defensible proxy for `P(success)` alone.
- A cached `.sabi/profile.json` — rejected; a second source of truth against an append-only log, with an invalidation story this doesn't need yet (a fresh scan per server-process lifetime is cheap enough).
- Consulting the profile in the `unclassified`/difficulty branch too — rejected; that branch has no proposed escalation to decline when confidence is low, so using the profile there would mean inventing an escalation the deterministic policy never proposed.
- A third-party benchmark table (pasted this session, unverifiable) as the basis for routing scores — rejected outright; this repo verifies model/benchmark facts against live sources or labels them unverified, never against a table it can't check.

### Tradeoffs
- The tie-breaker is decline-only and one-directional: it can make an escalation fall back to a tier the deterministic policy already proposed, never invent a tier or push toward a *stronger* one.
- Below `n = 30` for either the incumbent or the candidate tier, the feature is silent — behavior is byte-for-byte identical to before this change. On a fresh clone, or for a tier/model combination this account rarely exercises, that's most tiers, most of the time, by design.
- `packages/evals/src/backtest.ts` is a real-log measurement tool, not a pass/fail gate like `run.ts` — it reports what changed, it doesn't assert a threshold. Run against this machine's real 550-row log, it reports zero eligible pairs at all — this machine's traffic apparently has no `sessionKnown: true` rows adjacent to a hard failure, a real fact about this data, not a defect; the pairing/exclusion mechanics are proven separately by 11 synthetic unit tests in `recovery.test.ts`.

### Revisit later?
Once real judged traffic accumulates past `n = 30` on more tier/model pairs, re-run `npm run backtest` and check whether the declines it reports look right, not just whether the gate fired. Consider whether the recovery signal is worth exposing to the Class A mod path — `judge.ts` is proxy-only today; wiring Jev into the mod at all is a separate, larger change, not bundled here.

---

## [2026-09-19] Agent Controller: a new advisory-only surface, not a proxy-path feature

### Decision
A new package, `packages/controller` (`@sabi/controller`), adds a standalone CLI — `npm run controller -- "<request>" [--cwd=<path>] [--orchestrate] [--json]` — that recommends one of five actions for a request arriving *before* any harness session is chosen: CONTINUE, DELEGATE, SPAWN, ORCHESTRATE, or ASK. It is invoked separately from the inference-round proxy; nothing in `packages/server` calls it. V1 is advisory/shadow-mode only: `decide()` is a pure function over `ControllerSignals`, the CLI logs every call to `.sabi/controller-decisions.jsonl`, and it never itself executes DELEGATE, SPAWN, or ORCHESTRATE — those verbs describe what a human (or a later version) would still have to do by hand. The rubric is five branches, first match wins, built only from signals already available in this repo: an explicit `--orchestrate` flag or a small keyword allowlist → ORCHESTRATE; the current cwd's own `.sabi/decisions.jsonl`, most-recent-row-within-30-minutes showing `outcome==='ok' && state.failure==='hard'` → SPAWN; Orca's read-only `worktree ps --json`/`terminal list --json` reporting a worktree/terminal already open on this exact `cwd` → DELEGATE; no request text, no Orca, and zero recent log rows (a true conjunction) → ASK; otherwise → CONTINUE, with `git status --porcelain` cleanliness recorded in the reason string only, never as a gate.

### Why
A real controller genuinely operates above where Sabi sits today: the proxy only ever sees requests from an already-running, already-chosen harness session (this doc's "harness loop stays native" language, `docs/context.md`) — there is no earlier hook to wire into inside the live request path, so putting this logic in `packages/server` would be circular. Two Explore passes confirmed, before any design: no live "what's running" registry exists anywhere in Sabi (`DecisionRecord.sessionId` is a post-hoc analytics grouping, not a live identity); Orca (external, third-party `orca-ide` binary) does expose real read-only JSON commands, but `context/Hugo OS/postmortems/2026-08-03-orca-br-skill-legacy-read-only.md` (sources: `stablyai/orca#12034`, `#11993`, `#10406`, `#11582`) records a real worker-lifecycle delivery bug (`worker_done` rejected with `legacy_read_only`/`effectsApplied:false` on a run that wasn't actually legacy) — so it must be treated as best-effort, never a hard dependency, and it may not even be installed. The rubric reuses, rather than reinvents, this repo's own established signals: the exact `state.failure === 'hard'` predicate `recovery.ts` already established as the correct per-round failure signal, and `@sabi/core`'s own `readDecisions()` reader. No invented probabilities, benchmarks, or ML — same discipline as the recovery-rate tie-breaker above.

### Alternatives considered
- Wiring routing logic into the existing proxy request path — rejected; no hook exists before a harness session is already live.
- Gating the stuck-session signal on `DecisionRecord.sessionKnown === true`, matching `recovery.ts` exactly — rejected for this feature; the recovery tie-breaker's own entry above records that a 550-row real backtest on this machine found zero `sessionKnown: true` rows, which would make SPAWN permanently unreachable here. Gated on recency (`STALE_AFTER_MS = 30min`, `packages/controller/src/signals.ts`) instead — an explicit, named tradeoff, not a silent substitution.
- A learned/probabilistic classifier for multi-scope request detection — rejected; an explicit `--orchestrate` flag is the reliable signal, a five-phrase keyword regex is a deliberately coarse secondary heuristic.
- Executing DELEGATE/SPAWN/ORCHESTRATE directly (actually invoking Orca or spawning a harness) — rejected for v1; the same conservative, decline-only-first-step discipline the recovery tie-breaker used for its first landing.

### Tradeoffs
- The `STALE_AFTER_MS` recency gate can mis-signal on very recent but unrelated activity (a different branch, a stray manual `.sabi` write) — it is a proxy for "current session" until Sabi has a real live session identity, which does not exist anywhere in the codebase today.
- Orca's real `worktree ps --json`/`terminal list --json` output is an envelope, `{ id, ok, result: { worktrees/terminals: [...] } }`, not a bare array — confirmed by querying the live `orca-ide` 1.4.201 install on this machine directly (read-only) during this same PR's review pass. `runOrca()` now parses that real shape (`unrecognized-shape` still catches a genuinely wrong/future-drifted response, including the old bare-array assumption, regression-tested). `matchingWorktree`/`matchingTerminal` now do a real path-only comparison (`path.resolve(entry.path/worktreePath) === cwd`) — deliberately not branch-aware, because the live query observed `branch: ""` on real entries, making branch an unreliable signal today. Verified end to end against this machine's real state: `npm run controller -- "..." --cwd=<a repo orca already has a worktree open on>` returns `DELEGATE` for real, the first time this action has ever fired outside a synthetic fixture. This is still not a stable, published contract — `orca-ide` is third-party; re-verify if its version changes.
- Multi-scope detection is a five-phrase keyword allowlist plus an explicit flag — real requests using different phrasing fall through to CONTINUE/ASK rather than ORCHESTRATE; the flag is the intended reliable path.
- No caller in this repo invokes the controller yet — it is a standalone CLI a human (or a future harness wrapper) runs by hand; nothing in the live routing path depends on it.

### Revisit later?
Once Sabi has any live session identity (not just the post-hoc `sessionId` grouping), replace the recency-based stuck-session gate with a real per-session filter. If `orca-ide`'s real entries ever carry a non-empty `branch`, consider whether branch should join `path` in the match predicate, or stay path-only by design (a worktree is already a distinct path per branch in Orca's own model, so branch may be redundant, not just unreliable). Only after the shadow-mode log shows the recommendations look right on real usage should executing DELEGATE/SPAWN/ORCHESTRATE even be considered — a separate, larger decision, not bundled here.

## [2026-09-19] Agent capacity is a deterministic gate before handoff judgment

### Decision

Keep capacity and session-health routing pure in `packages/controller/src/agents.ts`. An active session with `quota_exhausted` or a rate limit is not eligible for `CONTINUE` when its reset wait exceeds the explicit transfer-cost bound (`handoffMs + replacementExecutionMs`, with a separate rate-limit threshold). Once `resetAt` passes, the same session becomes eligible again. If it is not eligible, reuse a suitable existing session before selecting a suitable harness to spawn. Carry the task in a typed `HandoffSnapshot`; the planner never reconstructs or restarts the work.

### Why

A provider quota wall, dead process, unavailable authentication, repeated identical failure, explicit blocked/waiting state and missing required capability are observable eligibility facts, not Jev questions. The planner therefore removes the current route first and leaves model/agent preference among valid candidates as a later decision. Healthy capacity outranks a `lower_priority`/`cheaper_model` fallback, so an exhausted Claude session does not silently consume scarce fallback capacity while a healthy Codex session exists.

### Tradeoffs

The costs are supplied by the caller in milliseconds; no invented provider reset or execution estimate is stored in Sabi. This is still shadow-mode logic: no live agent inventory, automatic handoff, process spawn or Jev selection is wired. The next required adapter is a verified inventory source that can populate these descriptors and snapshots without exposing credentials or raw usage logs.
## [2026-09-19] Provider-neutral secret discovery at proxy startup

### Decision
The proxy loads only environment references used by enabled upstreams and Jev. Precedence is the
existing process environment, `SABI_SECRETS_FILE`, the nearest workspace `secrets/.env`, then
`~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. The dotenv reader does not execute shell
syntax, values remain in the Sabi process, and provider aliases such as the existing HugoOS
`typesafe=` entry can satisfy `$TYPESAFE_API_KEY`.

### Why
Sabi is used through different harnesses and providers. Making Orca responsible for credentials
would couple the proxy to one host and currently available plugin launch APIs, while requiring
every user to export keys manually made the shared setup brittle. Loading only active references
keeps the central workspace file useful without copying unrelated secrets into the process.

### Alternatives considered
- Orca-managed launch injection — deferred until Orca exposes a stable, consented secret-reference
  launch contract; no plugin vault enumeration or terminal message transport is needed now.
- Loading every `.env` entry — rejected because unrelated workspace credentials must not enter Sabi's
  environment.
- Hardcoding HugoOS's absolute path — rejected because users may run Sabi from other workspaces or
  without Orca.

### Tradeoffs
The nearest workspace file is a convenience for deliberately shared workspaces; users needing a
different boundary can set `SABI_SECRETS_FILE`, and shell variables still override the file. The
proxy startup reports only a loaded count and file path, never names or values.

### Revisit later?
When Orca provides launch-time secret references, add an adapter-level source behind this same
precedence contract. Keep the core and non-Orca harnesses unchanged.

## [2026-09-19] Controller hooks are source-only until a publishable artifact exists

### Decision

Keep the controller daemon, Claude/Codex hooks, OpenCode bridge and Orca bridge in the monorepo's
source/PR delivery path. Keep the existing `vX.Y.Z` release workflow scoped to the packaged Command
Code adapter `@vizuh/sabi`.

### Why

PR #22 is merged on `main`, but the root controller and Orca bridge are private workspace packages and
are not included in the npm tarball. Publishing a new package tag for controller-only changes would
claim a release artifact that does not contain those changes.

### Tradeoffs

The controller is usable today from a checkout via `npm link`, while public installation remains
limited to the Command Code adapter. A future controller release needs an explicit artifact, package
name, versioning rule and live-host acceptance evidence before the release workflow should expand.

### Revisit later?

When those four inputs exist, add the controller package to a deliberate release lane; do not broaden
the current npm workflow implicitly.

## [2026-09-19] Public installation is a separate controller release lane

### Decision

Treat `npm link` and workspace dependencies as development-only. Publish the controller as a bundled
`@vizuh/sabi-controller` package with its own release workflow, user-level daemon lifecycle and
verified host integrations. Keep `@vizuh/sabi` as the existing Command Code adapter package.

### Why

A user opening an Orca worktree must not need a checkout, `node_modules`, an interactive `PATH` or a
per-worktree install. The current source bridge cannot satisfy that contract, and combining it with
the existing adapter artifact would silently change the public package boundary.

### Tradeoffs

There are two release lanes to maintain, and each harness still needs an installed-contract proof.
The first public release may support only Claude, Codex and OpenCode, with Orca inventory/dispatch
marked partial until its plugin installation and universal event contract are verified.

### Revisit later?

Only expand the support matrix after a clean-machine install and live terminal receipt for that
harness. An executable discovered on `PATH` is never enough evidence.

## [2026-09-19] Design evidence is optional and local

### Decision

Treat TokenScout-like site analysis as an optional local evidence provider, not a required Sabi
dependency or a public routing rule. Keep raw reports, Design DNA, screenshots, assets and site
references under ignored local runtime state such as `.sabi/`. If routing consumes the result later,
pass only bounded, redacted evidence signals and a soft model-affinity prior.

### Why

A design reference can provide useful evidence for visual work, and current local research makes Kimi
K3 a reasonable hypothesis for that lane. The evidence is still task-, harness- and user-dependent;
hard-coding `design -> Kimi` would turn an unverified prior into a brittle policy and would push
site-specific data into the public repository.

### Tradeoffs

Users without TokenScout keep the normal route. Users with it can improve a reference-driven design
handoff locally, but Sabi cannot compare the prior honestly until outcomes, acceptance and repair work
are recorded. A failed or unauthorized study must fail open to the existing route.

### Revisit later?

Add a generic evidence-provider contract only when a second provider or a real routing consumer needs
it. At that point validate the signals, redaction boundary and replay behavior with local fixtures
before adding any provider package or model-specific default.

## [2026-09-19] Bundle the controller without widening the adapter release

### Decision

Keep `packages/controller` private inside the workspace, but build its public boundary as a bundled
`@vizuh/sabi-controller` staging package. Release it only from `controller-v*`; leave the existing
`v*` workflow and `@vizuh/sabi` Command Code package unchanged.

### Why

The controller imports private workspace code and cannot be installed safely from a clean machine as
raw TypeScript. Bundling removes that runtime dependency and gives users one global CLI while keeping
the existing adapter's package contract stable.

### Evidence and limits

The local package test builds, packs and installs the tarball into a temporary npm prefix, then runs
the installed CLI and `doctor` without the checkout's `node_modules`. This proves packaging, not npm
publication, login-service persistence, universal Orca activation or cross-terminal execution.

### Revisit later?

Only publish a `controller-v*` tag after the clean-machine and Phase E live host gates pass. Add
platform service installers and broader harness claims as separate evidence-backed changes.

## [2026-09-20] Evidence-aware adaptive scheduler vNext foundation

### Decision

Use GitHub Spec Kit to specify and implement the first evidence-aware scheduler slice while keeping
the deterministic router as the active policy. Add typed evidence provenance, verification and scope
coverage, recovery actions and graded recovery attribution, bounded judge evidence slots, controller
recovery capsules, semantic profiles, and calibrated offline eval subsets. Keep profile candidates
shadow/backtest-only; no learned candidate changes active routing.

### Why

The supplied research synthesis identifies a stronger loop than `state -> tier -> model`:
`state -> missing evidence/recovery action -> route -> observe -> validated episode`. The repository
already had bounded state, receipts, controller handoffs, and fixture evals, so additive contracts
and pure helpers were sufficient; a database, queue, RL loop, or new provider was not.

### Tradeoffs and limits

- Observed, matched, and replayed recovery are separate; fixture replay is explicit and never runs
  implicitly on live work.
- Semantic profiles report local evidence by operation/model/harness, but they do not establish a
  universal model ranking or change routing.
- PRE/LIVE/POST labels describe offline fixture evidence; they are not live provider receipts.
- The controller capsule preserves bounded verified facts and failed approaches, but a real external
  harness consuming the capsule is not proven by local tests.

### Revisit later?

Only promote candidates after holdout/backtest and regression gates show benefit. Add live token
receipts, durable multi-process learning, or utility-based active routing only with a real harness
contract and outcome evidence.

## [2026-09-19] Linux user service is the first ambient-runtime backend

### Decision

Have `sabi setup` attempt a per-user `systemd --user` unit on Linux, using absolute installed paths,
and report a lazy detached fallback when the user bus is unavailable. Keep macOS and Windows service
installation unsupported until each is validated on its own platform.

### Why

The daemon must survive a terminal closing and should not require root or a worktree-local process.
Linux is the current verified host, while pretending that a PATH executable or an untested service
template works on every OS would make the public support claim false.

### Revisit later?

Add LaunchAgent/Windows user-service implementations only with platform tests covering install,
restart, status, upgrade and uninstall rollback.

## [2026-09-19] Redact Orca preview context at the inventory boundary

### Decision

Treat Orca terminal titles/previews as untrusted bounded text. Redact common reset/access token,
API-key, bearer and password/secret patterns before exposing context in inventory, routing telemetry
or handoffs. Keep raw screen text in-process only for capacity classification.

### Why

Real live inventory showed that an otherwise idle terminal preview can contain a password-reset URL.
Session discovery must not turn that into `sabi status` output or a persisted candidate descriptor.

### Revisit later?

Expand the redaction canary corpus when a new provider/harness exposes a credential format; never
replace it with storing full terminal transcripts.

## [2026-09-20] Sabi inference-round routing is independent of Orca lifecycle supervision

### Decision

Sabi has two related contracts. Its inference scheduler routes one model/config per model-request
round (observe request → classify → choose model/config → execute → observe result → update
routing). Its controller may also route a task before a harness session is chosen, including
CONTINUE/DELEGATE/SPAWN/ORCHESTRATE decisions. Orca lifecycle supervision is an optional higher
adapter layer, not a dependency of either Sabi routing contract. Full-lifecycle settlement (Orca
`worker_done`) belongs in a thin Orca-side adapter, never in a harness fork or an Orca dependency
inside the routing core.

### Why

A live Orca trial (2026-09-20) separated the questions. Orca launched `opencode run` and an
interactive `opencode` TUI in managed terminals; the TUI completed an injected task
(`ORCA_TRIAL_OK`, served by `sabi-code` in 6.0s) with matching `ok` routing rounds in the decision
log — so the Orca → terminal → harness → Sabi → model chain is real. What failed is a different
layer: `worker-start --terminal` refused the raw process (`agent_unconfigured`; only recognized
agents qualify), and the inject lane (`dispatch --inject`) carries Task context without supervision
(OpenCode cannot send `worker_done`; release stays refused). Routing worked throughout; supervision
did not — proving the layers are independent.

The trial used `orca-ide 1.4.201` and OpenCode CLI `1.18.31` on Node `v24.15.0`. Those exact
versions pin the observation, not a stable Orca protocol: the installed CLI exposes no upstream
repository/commit for the worker contract, so the lifecycle conclusion remains unverified for
other Orca releases and must be re-run after an Orca upgrade.

### Alternatives considered
- Make Sabi an Orca plugin so supervision comes free — rejected; it would inherit one
  controller's limitations and violate the harness-loop-native rule (all harnesses stay peers).
- Patch OpenCode to speak Orca's worker protocol — rejected; never fork a host harness beyond its
  supported extension surface.
- Keystroke-inject the TUI to fake `worker_done` — rejected; observation only, no simulated input.

### Tradeoffs
- Headless runs already expose a completion signal (process exit → transcript + `ok` round), so the
  shim only needs to map exit to `worker_done`; interactive-TUI settlement (idle ≠ done) stays an
  explicitly deferred question.
- An Orca-side adapter must be a recognized agent process; its design depends on Orca's agent
  contract, not Sabi's.

### Revisit later?

Prototype the headless shim first. Before building, read the in-flight controller daemon,
user-service, CLI, hooks and Orca-bridge implementation on `main` — it may already own half of
the adapter box. Never duplicate it by accident.

## [2026-09-20] Runtime catalogs are evidence; route the execution tuple

### Decision

Treat `(harness, model, provider/plan, effort, session)` as the routing unit. The controller may
discover mutable local catalogs from verified harness commands and attach bounded descriptors to
spawn candidates. Each descriptor records the model ID, a deterministic `worker`/`judge` role,
`explicit-free` or `unknown` cost class, runtime version, observation time and a hash of the full
catalog output. Missing source repository/commit, plan entitlement, price and quota remain unknown.

Availability, authentication, capacity, capability and measured-token evidence are deterministic
gates. Jev is consulted only after code constructs the closed valid action set; its returned choice
is validated before execution. A Jev model is not a coding worker merely because it appears in an
OpenCode catalog.

### Why

The installed OpenCode catalog contains mutable free-labelled and paid/unknown IDs, while the
dashboard/catalog does not by itself prove plan access or billing semantics. Hardcoding the list
would drift, and asking Jev to do arithmetic would make missing price or token data look certain.
Runtime version plus output hash makes an observation reproducible enough to audit without storing
raw output or credentials. Native OpenCode free models remain harness resources; Sabi's proxy cannot
silently consume or switch a native subscription model.

### Alternatives considered

- Hardcode the current OpenCode model list — rejected; it becomes stale and is not a plan check.
- Label every non-free ID as paid — rejected; the installed catalog does not establish billing.
- Let Jev choose any catalog ID — rejected; Jev must choose only among executable candidates.
- Add learning, subscription economics and token estimates now — rejected; controller receipts do
  not yet contain the measured fields needed to validate those claims.

### Tradeoffs

- Catalog probing adds a bounded local CLI call and a 60-second cache.
- Runtime evidence is stronger than a name-only claim but weaker than source-pinned or plan-verified
  evidence when the harness exposes no source revision or entitlement API.
- The current phase inventories all models visible to verified OpenCode/Command Code probes but does
  not automatically route every task among them.

### Revisit later?

Add token receipts (`input`, `output`, cache, tool-observation, compaction, latency and outcome),
plan/health evidence and replay/held-out promotion gates before learned model profiles or
AgentRun/SoL-Pi-style policy/harness evolution. The acceptance contract is in
`docs/research/harness-model-token-routing.md`.

## [2026-09-20] OpenCode model health is receipt-aware and fail-open

### Decision

Keep the first health-aware selection slice process-local and deterministic. When the controller
executes a configured harness/model target, it records the observed receipt outcome and elapsed
controller time. A failed model is temporarily unavailable for the next catalog selection; the
next valid configured worker is preferred. If all configured workers are unavailable, selection
returns the first valid worker instead of inventing a new route. An unverifiable receipt records
unknown health and does not promote or demote the model.

### Why

The catalog proves model identity but not usable capacity. A bounded execution receipt is the
smallest evidence layer that can distinguish a recent failed worker from an unobserved or
unverifiable one and lets OpenCode try another configured worker without a paid probe.

### Limits

The elapsed value is controller-observed receipt/completion latency, not first-token latency. Health
expires after 60 seconds and is not durable across daemon processes or restarts. This phase does
not infer plan entitlement, quota, token usage, cost or model quality, and it does not create a
learned routing policy.

### Revisit later?

Promote only after live free-model and fallback receipts provide runtime-pinned evidence, then add
durable health or learned profiles only if cross-process recovery and held-out outcome data justify
them. Keep paid probing and subscription claims outside the automatic path.

## [2026-09-20] OpenCode Muse is a deferred native lane, not a proxy model ID

### Decision

Raise the OpenCode adapter's advertised output ceiling from its unknown-metadata fallback by
declaring the verified minimum across the current OpenRouter tiers (`128000`). Keep the current
Sabi proxy as the adaptive action path. Do not add `opencode/muse-spark-1.3-contributor-free` to
`sabi.config.json`: the installed OpenCode catalog exposes it through a native Responses provider,
while Sabi's proxy forwards Chat Completions to configured OpenRouter/Ollama upstreams.

### Why

The observed short value was `limit.output: 4096`, not the adaptive context window (`1000000`).
Muse's larger output metadata does not make its native provider reachable from the current proxy, and
the free offer is temporary. `small_model` can be an explicit OpenCode utility choice, but it is not
a Sabi per-round model-selection hook. The connector accepts an explicit
`--small-model=provider/model` override for that utility lane and leaves the adaptive main model
unchanged.

### Revisit later?

Only add Muse as an action tier after a Responses upstream, explicit credential boundary, tool and
stream translation, context-fit checks and safe cross-model reasoning behavior have focused tests
and a bounded free-only smoke. The issue and task list are in
`docs/specs/opencode-muse-cheap-lane.md` and `docs/tasks/opencode-muse-cheap-lane.md`.

## [2026-09-20] Same-harness model fallback precedes unrelated session fallback

### Decision

When a spawned harness/model fails before its send receipt shows acceptance or turn start, keep the
failed `(harness, model)` excluded and prefer the next available configured worker from that same
harness. Only after that candidate set is exhausted may the controller choose an unrelated idle
session or another harness.

### Why

A model receipt failure is evidence about the selected worker, not necessarily about the harness
itself. Keeping the retry in the same harness preserves the requested execution shape and makes
model-health telemetry actionable before spending context-switch cost on another session.

### Limits

The focused proof uses fake Orca envelopes and process-local health. It does not prove a real quota
failure, provider entitlement, task correctness or cross-process recovery. Accepted/started turns
remain non-retryable.

### Revisit later?

Keep the live quota/fallback gate separate and pin the installed harness/Orca versions and receipts
before treating this ordering as live runtime evidence.

## [2026-09-20] Free OpenCode evidence closes native execution only

### Decision

Treat the bounded `opencode/ling-3.0-flash-fin-free` run as evidence for native OpenCode free-model
execution and Sabi plugin/daemon continuity. Do not count it as controller model-health evidence:
the plugin registered the current session, the bounded action set was `CONTINUE`, and no controller
execution receipt was needed.

### Why

The safe current-session result is the correct behavior for a read-only smoke. Claiming that it
proved per-turn model switching or spawned-target health would confuse native harness execution with
controller lifecycle execution.

### Revisit later?

Run the quota/fallback case only when an addressable controller target is available. Keep unknown or
paid observations behind explicit spend approval and pin runtime/catalog evidence for each run.

## [2026-09-20] Controller execution evidence is typed, bounded and retry-safe

### Decision

The controller treats an Orca action as verified only when its documented result shape contains an
explicit receipt. Terminal send, wait, read, terminal creation and orchestration responses use small
typed parsers; unknown envelopes become `unverifiable` and cannot silently authorize a hook to block
the current harness. Controller-generated idempotency keys correlate plan, route, execution and
OpenCode outcome records, with a bounded process-local completed/in-flight cache.

Inventory discovery uses a two-second process cache and every quota/rate-limit retry forces a fresh
snapshot. A retry is allowed only for an explicit retryable failure; the same structured handoff and
idempotency key are retained. Jev receives bounded candidate and handoff state, not raw catalogs,
terminal transcripts or diffs, and may choose only from the code-generated valid action set.

### Why

The live debate exposed four unsafe assumptions: `inputAccepted` is not proof that a turn started,
idle is not proof that work completed, stale inventory can select an unavailable target, and
recursive result scans can bind an unrelated nested field. Large catalogs and diffs also add cost and
unnecessary data exposure to a routing judgment. Explicit shapes make failures visible and preserve
the fail-open boundary for native harnesses.

### Limits

The idempotency cache is process-local, not durable across multiple daemon processes or restarts.
Receipts prove the observed Orca boundary, not host token usage, task correctness or `worker_done`
settlement. A two-second inventory TTL is a bounded freshness tradeoff, not a quota guarantee.

### Revisit later?

Add durable receipts only when the daemon can run with multiple workers or must recover across restarts;
add host token/cost fields after a harness exposes a stable usage contract; add full orchestration
settlement only in a verified Orca-side adapter.

## [2026-09-20] Hermes uses the native Sabi proxy seam, not a second router

### Decision

Certify the pinned Hermes main-conversation path through public `llm_request` middleware and the
existing `custom:sabi` / `sabi-code` Chat Completions provider. The plugin supplies only opaque
session/turn attribution; the shared Sabi proxy performs the per-request trajectory decision and
forwards the selected upstream. Hermes keeps its loop, tools, permissions, retries, streaming,
cancellation and compaction.

### Why

The isolated probe proves fragmented tool call/result preservation, resume with a new turn, three
unique Sabi receipts, and shared policy routing `mid → cheap → mid`. A direct model swap cannot
transfer a provider subscription, while the proxy is an honest cross-provider boundary and avoids
a second Python policy implementation.

### Alternatives rejected

- Reimplement Sabi policy in the Hermes plugin.
- Rewrite arbitrary Hermes provider/model choices from middleware.
- Let Jev delete or rewrite the Hermes transcript.

### Revisit later?

Auxiliary/subagent calls, real-provider quality, and ContextEngine behavior need a pinned runtime
contract, rollback path and separate held-out test. The V1 contract/checklist are in
`docs/specs/hermes-sabi-routing.md` and `docs/tasks/hermes-sabi-routing.md`.

## 2026-09-20 — Command Code receipts reuse the core evidence schema

### Decision

Persist only rounds with an actual Sabi serving plan as a normalized `DecisionRecord` beside the
Command Code workspace. Keep the legacy custom entry, use an opaque `sessionId` with
`sessionKnown: false`, hash tool identities with the proxy helper, and omit price/cost because a
harness subscription catalog is not a verified BYOK rate.

### Why

The shared log is the smallest common evidence surface for later reports, replay and recovery
learning. It avoids a second adapter-specific ledger and does not pretend that a host round or
subscription receipt proves task success or spend.

### Limits

The host currently exposes no real session ID, model-request latency, task-level outcome or
provider cost. The first host-served round has no Sabi plan and is therefore not recorded as one.
Jev, catalog fallback and learned policy remain separate follow-up slices.

## [2026-09-20] OpenCode Muse is a deferred native lane, not a proxy model ID

### Decision

Raise the OpenCode adapter's advertised output ceiling from its unknown-metadata fallback by
declaring the verified minimum across the current OpenRouter tiers (`128000`). Keep the current
Sabi proxy as the adaptive action path. Do not add `opencode/muse-spark-1.3-contributor-free` to
`sabi.config.json`: the installed OpenCode catalog exposes it through a native Responses provider,
while Sabi's proxy forwards Chat Completions to configured OpenRouter/Ollama upstreams.

### Why

The observed short value was `limit.output: 4096`, not the adaptive context window (`1000000`).
Muse's larger output metadata does not make its native provider reachable from the current proxy, and
the free offer is temporary. `small_model` can be an explicit OpenCode utility choice, but it is not
a Sabi per-round model-selection hook. The connector accepts an explicit
`--small-model=provider/model` override for that utility lane and leaves the adaptive main model
unchanged.

### Revisit later?

Only add Muse as an action tier after a Responses upstream, explicit credential boundary, tool and
stream translation, context-fit checks and safe cross-model reasoning behavior have focused tests
and a bounded free-only smoke. The issue and task list are in
`docs/specs/opencode-muse-cheap-lane.md` and `docs/tasks/opencode-muse-cheap-lane.md`.## 2026-09-20 — DeepSeek Harness uses a published bundle over the native provider seam

### Decision

Publish `@vizuh/sabi-deepseek-harness` as a configuration-only DSH bundle. It contributes the
`sabi` provider and `sabi-code` model to DSH's existing `@deepseek-ai/dsh-llm-pi-ai` adapter, whose
OpenAI-compatible request reaches the local Sabi proxy. DSH remains responsible for the agent loop,
tools, streaming, approvals and session state. Sabi remains responsible for trajectory routing behind
the proxy. The controller manifest reports DSH as `inference-only` until session and outcome seams
are independently proven.

### Evidence and limits

The bundle was authored against DeepSeek Harness `0.1.6-alpha.2` at upstream revision
`ddefc45fbc7f8e46dd73185e68295696d1297887`. That runtime is a developer preview with expected
breaking changes. The local environment did not have a `dsh` executable, so package/patch tests are
the only current evidence; no DSH boot, model request, stream receipt, paid provider request, or
quality result is claimed. The next gate is a pinned, bounded DSH → Sabi → mock probe.

### Why

A bundle is the smallest supported DSH extension surface and reuses DSH's maintained protocol and
stream translation. A custom `ctx.llm` adapter would duplicate that surface before the DSH runtime
is stable. The package does not make Sabi the DSH default model automatically and carries no model
price, plan, quota, image, or reasoning-effort claim.

## [2026-09-20] OpenRouter free quality is an opt-in fixed lane

### Decision

Refresh OpenRouter's live `/models` catalog only when the operator passes `--free-quality`. Select
the first deterministic candidate whose catalog reports exact zero prompt/completion pricing, text
input/output, tools and an output-token parameter. Write it as `quality`, expose `sabi-quality`, and
map only `verification` to that lane. Keep paid tiers and recovery escalation unchanged.

### Why

Verification and review are useful places to test opportunistic capacity, but a model name or
catalog presence is not enough to call a model free or good. Exact catalog pricing, provenance and a
fixed alias make the boundary inspectable. Free-only Command Code registration refuses the adaptive
alias while it can still reach paid branches.

### Limits

The live 2026-09-20 stress run found availability, response-shape and rate-limit behavior, not
quality: four current candidates handled 12 synthetic rounds with 7 non-empty receipts, 4 empty
choice shapes and 1 HTTP 429. A complete Sabi proxy round through `sabi-quality` returned HTTP 200,
the required marker and a `quality` decision using `dots-studio/dots-3-note-preview:free`. No paid
fallback, private prompt or completed-task quality claim was used.

The next gate is a user-approved privacy-safe task set with receipt-aware demotion and held-out
evaluation. Debate and learned quality profiles remain out of the first lane.

## [2026-09-20] Surplus inference starts as explicit shadow QA

### Decision

Treat zero-cost inference as a separate review resource, not as a replacement for the primary
model. The first controller slice exposes `sabi surplus inventory|review|history`, sends only a
bounded tracked diff through a fixed zero-cost alias, parses advisory claims, and persists a
metadata-only receipt.

### Safety boundary

Adaptive aliases, paid fallback, tools, environment values, credentials, absolute paths and
secret-like packets are excluded. A successful response proves only that a structured advisory
receipt was obtained; `verifiedClaimCount` remains zero until deterministic evidence proves a claim.
Rate limits and proxy failures are recorded and fail open for the primary task.

### Follow-up gate

Add verifiers, approved completed-task/held-out data, independent receipts per free resource and
Jev intent selection before fan-out, advisory handoff or learned model-by-intent promotion.

## [2026-09-20] Surplus review uses a bounded council protocol

### Decision

Represent extra review as `none`, `probe`, `panel`, `debate`, or `council`. JEV may later select
the mode and uncertainty; independent seats ask distinct questions; cross-examination is reserved
for material disagreement; deterministic verification, not model confidence, determines whether a
claim is actionable.

### Evidence and operations

Add an append-only metadata-only ledger for harness, runtime version, provider, model, seat, stage, status, evidence
level, hashes, counts and measured usage. `sabi council record|history` is an evidence surface, not
a model executor. OpenCode and Hermes remain peer adapters and must report their installed runtime
and actual receipt level before any council quality claim.

### Revisit

The ledger and protocol are shipped before automatic planning or debate. Add adapters, verifiers,
held-out replay and learned promotion only after privacy and completion-receipt gates pass.

## [2026-09-20] Hermes-first setup uses the native Nous proxy boundary

### Decision

Make the Hermes onboarding wizard create an isolated, ready-to-copy profile:
`Hermes sabi-code → Sabi → Hermes Nous proxy`. Keep OpenCode Go and ChatGPT Plus as native
Hermes providers; do not claim that the V1 middleware can transfer their subscriptions into Sabi.

### Why

Hermes owns authentication and its supported `llm_request` seam, while Sabi owns per-request routing
behind the local custom provider. The generated profile contains no credentials, does not mutate the
checkout's main config, and uses only model ids observed in the Nous catalog; catalog presence is not
entitlement. The standalone `@vizuh/sabi-controller` package was not available on npm at this check,
so the documented Hermes path is the repository checkout.

### Revisit later?

Run a bounded paid smoke with the user's logged-in Nous account, then separately decide whether a
Nous API-key profile is needed. Do not promote mock compatibility or catalog presence into provider
quality, quota or plan evidence.

## [2026-09-20] Host-AI onboarding uses one explicit OpenRouter credential

### Decision

The setup wizard and host-AI runbook ask for `OPENROUTER_API_KEY` only when a proxy route or the
optional AI explanation is selected. Native Command Code uses its own subscription without a Sabi
key; Claude/Codex hooks use controller state without a provider key; Hermes may still choose its
isolated Nous proxy. Provider BYOK keys, priority and fallback remain configured in OpenRouter,
not copied into Sabi or a host config.

### Why

This gives users one understandable credential boundary while preserving each host's supported
loop, auth store, tools, permissions and subscription semantics. Jev is a separate optional judge
and therefore no longer appears as a default second-key question. The explanation option is local by
default; AI explanation is explicit, bounded and allowed to fall back locally.

### Revisit later?

Move the flow behind the released `@vizuh/sabi-controller` package only after its controller-v*
tag, clean-machine package proof and host-specific live receipts exist. Do not describe Claude/Codex
hooks as native per-round model switching, or OpenRouter BYOK configuration as verified entitlement.

## [2026-09-21] Security findings get fixed only when the fix has no design decision embedded

### Decision

Of the findings from the 2026-09-21 full-repo security review
(`docs/reviews/security-review-2026-09-21.md`), fix in-place only the ones whose correct behavior
is unambiguous from the surrounding code (Orca dispatch control-character rejection, daemon
`--json` token redaction, the setup wizard writing what it prints, log file permissions matching
the controller's own convention, constant-time token compare, hook-command quoting). Leave the
inference proxy's missing authentication documented but unfixed.

### Why

Adding authentication to `packages/server` is not a hardening patch — it changes the API contract
every adapter (`opencode`, `command-code`, `hermes`, `deepseek-harness`, `prime-agent`) currently
relies on to talk to the proxy with zero credential. Whether that becomes an opt-in bearer token, a
loopback-refuse-only floor mirroring the controller daemon, or something else is a real design
choice with compatibility tradeoffs across every adapter's `connect.ts` — the kind of choice this
log exists to record, not one to make silently inside a security-fix commit. The six fixes that did
land share one property the auth question doesn't: their "correct" version was already implied by
sibling code in the same repo (the controller daemon's own loopback/token/mode patterns, the
default hook command's own quoting), so applying them was mechanical, not a judgment call.

### Revisit later?

Decide the proxy-auth design before building anything that assumes the local proxy is a trust
boundary. Also open: `SABI_DSH_BASE_URL` validation (blocked on a DSH-side plugin that doesn't
exist yet — the YAML patch is evaluated by DSH's own loader, not Sabi-authored code), and
`saveOpenRouterKey`'s narrow chmod-after-write TOCTOU window. The unsalted tool-name hash flagged
in the same review was independently fixed on `main` while this branch was in flight — `log.ts`
now HMAC-SHA256s with a per-install salt (`getIdentitySalt`) — so it's already resolved, not open.

---

## [2026-09-20] Surplus safety check gates council review before plan receipt

### Decision

In `runSurplusReview`, run `buildSafeReviewPacket` (surplus-level safety)
before `councilPreGate` (council-level viability), then write the plan
receipt via `createCouncilPlanReceipt` only when both pass.

### Why

`buildSafeReviewPacket` already refuses sensitive file paths and canary
markers with `'secret-path'`/`'unsafe-path'` reasons. Running the council
pre-gate after it preserves those exact error strings for existing surplus
tests and callers. The pre-gate adds checks that surplus safety does not
cover: zero-cost resource availability, per-mode call budget, and public-Scope
signal. Running both before any provider call means no seat starts unless the
review is both safe and viable.

### Alternatives considered

- Pre-gate first, then `buildSafeReviewPacket`: rejected — the pre-gate
  returns `'sensitive-paths'` (different string) for files that the surplus
  path expected to label `'secret-path'`, breaking `surplus.test.ts`.
- Pre-gate only (skip `buildSafeReviewPacket`): rejected — surplus-level
  file-safety checks (path-component validation, diff-size bounding) are
  not duplicated by the council pre-gate.

### Revisit later?

When JEV's semantic judgment replaces the deterministic pre-gate, re-evaluate
whether a single combined gate is cleaner.

---

## [2026-09-20] Plan independence: 'full' only with a separate synthesizer

### Decision

In `createCouncilPlanReceipt`, set `independence` to `'full'` when a
separate synthesizer seat is declared OR `mode === 'none'`; otherwise
`'reduced'`.

### Why

The spec says independence is reduced "if the same model and provider must
both review and synthesize." A `probe` or `surgery` with no explicit
synthesizer means one model does everything — that is `'reduced'`. `mode ===
'none'` is `'full'` because no seat runs at all, so there is no independence
constraint to violate. The previous draft included `mode === 'probe'` in the
'full' condition, which silently marked single-model probe rounds as fully
independent; the test caught it.

### Revisit later?

When multi-model synthesis becomes default, revisit whether `surgery`
without an explicit synthesizer should still be `'reduced'`.

---

## [2026-09-20] Plan receipt stores opaque hashes, not raw plan data

### Decision

`createCouncilPlanReceipt` persists `planSha256` and `inventorySha256` as
opaque hashes in the council ledger, not the full `CouncilPlan` object or the
file inventory.

### Why

The spec's field list is "opaque input/output hashes." Raw plan data
(seat objectives, provider routing) and raw file paths can change between
runs; hashing them decouples the ledger from plan structure. The hashes let a
later `record` receipt reference the exact plan+inventory that started the
round (`/plan` endpoint can re-derive from the same source). `RECEIPT_KEYS`
sanitizes any non-allowlisted field on write, enforcing the contract.

### Alternatives considered

- Store raw plan JSON: rejected — plan shape is not stable and includes
  provider/model fields that belong to execution receipts, not plan receipts.
- Store raw inventory paths: rejected — paths are environment-specific and
  would make receipts non-portable across machines.

---

## [2026-09-20] Harness is required on sabi council record

### Decision

`sabi council record` requires `--harness=<name>`; the previous default of
`'unknown'` is removed.
---
## [2026-09-21] Privacy/egress hardening for judge, proxy, trajectory and streams (#59 #60 #67 #68)

### Decision

- Judge egress is content-free by default: `buildJudgeState` sends hashed tool identity, evidence
  codes and length/hash shape, never raw instruction or tool text. Raw excerpts require the explicit
  `judge.includeSnippets` opt-in (or the shared `telemetry.captureSnippets`). Fail-open is unchanged.
- The loopback proxy is fail-closed on origin: non-loopback `Host`, non-loopback `Origin`/`Referer`
  and non-JSON chat bodies are rejected before any round executes, and `/healthz` no longer reports
  the absolute log path. No CORS allow-origin is ever emitted.
- The proxy derives `contextWindow` only when every reachable tier declares one, and detects `stuck`
  from consecutive hard failures of the same identified session (memory cleared on compaction).
  Unattributed requests get a window at most — no borrowed streak, no guessed generation.
- A clean EOF after a terminal choice completes with usage intact; mid-stream failures end with an
  explicit SSE error frame (deadline/abort still terminate); error bodies decode leniently so a
  non-UTF-8 429 keeps its status and `transport` outcome, while success bodies stay strict.

### Why

Each shipped-config rule or surface implied a guarantee the code did not keep: the judge bypassed
the telemetry policy it documented, the proxy executed cross-origin simple requests, two policy
rules could never fire on the proxy path, and three stream cases reported the wrong outcome. The
fixes keep legitimate local clients working (no `Origin` or loopback `Origin`, JSON bodies) and
keep all unknowns unknown rather than guessing.

### Revisit later?

Per-install proxy tokens (the controller daemon already has them) if the loopback boundary needs
authentication beyond origin; judge-signal quality measurement on redacted vs raw state before any
context-selection work; whether the failure streak should ever count past the harness's depth flag.
## [2026-09-21] Opt-in transport fallback retries the next serving tier; sabi-free lane deferred

### Decision

Adopt the uncommitted transport-fallback work found in the shared checkout (no commit on any
branch carried it) and port it to `main` conventions: `getFallbackChain()` in
`packages/core/src/router.ts` orders candidates cheapest-first by declared cost (ties by tier
name) instead of declaration order, skips the failed tier, disabled upstreams and
modality-mismatched tiers; the proxy retries 429/402/403 on adaptive rounds only when
`transportFallback.enabled` is `true` (shipped `false`), serves the planned tier's original error
when the chain exhausts, records `rule: transport-fallback` plus `DecisionRecord.fallback`, and
never touches fixed aliases. The `sabi-free` lane (`openrouter/auto` at declared cost zero) is
**not** adopted: no `OPENROUTER_API_KEY` is available to verify a genuinely free id, the cost-zero
claim for an auto-router would be false, and `surplusResources()` would auto-enlist the alias as an
`external-free` review resource on that false claim.

### Why

A rate-limited round should retry cheaper capacity, not escalate to strong or fail the turn — but
only as an explicit operator opt-in, since each retry is another upstream call that can spend. The
port drops the original draft's duplicated streaming block by reusing the single success path, so
the fallback cannot drift from normal serving behavior.

### Tradeoffs

- 5xx is not retried (only 429/402/403); a fallback that fails non-transport stops the chain.
- The chain can include a more expensive tier when it is the only serving one — opt-in means the
  operator accepts that; the record names the tier that served.
- Free-lane review capacity stays limited to whatever `--free-quality` verified live; the
  multi-alias surplus council (intent-gated specialists, no voting) remains spec, recorded in
  `docs/specs/surplus-inference.md`.

### Revisit later?

Verify a real free id via a live catalog refresh before shipping any `sabi-free` alias; consider
5xx retry and per-status retry budgets only after measured transport traffic justifies them.
