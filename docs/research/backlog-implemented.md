# Research backlog — implementation status

Confirmation for the research session (2026-09-18). The action items named in the
[folder review](folder-review.md), the [Command Code roadmap](command-code-roadmap.md)
and the [Prime reuse](prime-agent-reuse.md) acceptance checks were implemented against
their stated evidence. No new GitHub issues existed to comment on, so this file is the
comment handoff for the still-running research loop. No redundant validations were added:
each fix is tied to one acceptance check.

## 1. Telemetry is now content-free (folder-review Critical)

- `packages/core/src/state.ts` `detectFailure` emits **allowlisted evidence codes** only
  (`fail-marker`, `nonzero-exit`, `python-traceback`, `permission-denial`, …). No raw
  tool-output excerpts, no `snippet()` helper (deleted).
- `packages/core/src/telemetry.ts` gates every persisted reason:
  - `sanitizeReason` keeps a reason only when it is a bare code or ends in an allowlisted
    code; otherwise it becomes `reason withheld (telemetry.allowlistOnly)`.
  - `sanitizeError` redacts provider/upstream error bodies to a kind + first line + redacted
    credentials; the judge error `note` path is sanitized too.
  - `captureSnippets`/`captureChars` are the explicit opt-in for diagnostics; default off.
- `sabi.config.json` sets `telemetry.allowlistOnly: true`.
- The proxy (`server.ts`) and the mod (`mod/sabi.ts`) both run reasons/errors through the
  policy before they reach logs, `recent[]`/`/decisions`, or session custom entries.
- `sabi.config.json` also drops the "never prompt content" wording — the README/handoff
  already did.

**Acceptance (synthetic canary):** `packages/server/test/proxy.test.ts` sends a
`sk-live-…` marker in the user prompt and a tool result and asserts the serialized
decision log `!includes` the marker. `packages/adapters/command-code/test/sabi-mod.test.ts`
does the same for the mod's session entries. All pass.

## 2. Mod lifecycle: attribution, unknown usage, unavailable tiers (folder-review Important + Prime next-agent check)

- `servedBy` is cleared at `onTurnStart` (per-turn scope) and only advanced when a fresh
  `model_request_end` arrives; missing usage stays `undefined` rather than re-serializing
  a previous round's value.
- `lastUsage` only advances on a fresh `usage` event.
- Repeated-failure state is tracked across rounds (`previousFailure` carried from the plan
  that actually served the completed round, not a plan consumed two turns later).

**Acceptance:** `sabi-mod.test.ts` covers a missing-usage round (asserts `usage` stays
undefined instead of the old 100-token value) and a two-round identical failure (asserts
the served decision at round 3 records `rule: stuck`, `repeatedFailure: true`,
`failureStreak: 2`). `config.ts` now validates `harness.tiers` (model id, effort, minPlan).

## 3. Repeated failures and context pressure (roadmap "stuck-loop" + "context fit")

- `TrajectoryState` gains `repeatedFailure`/`failureStreak` (same hard failure as the
  previous round) and `contextTokens`/`contextKnown`/`contextWindow`.
- `policy.ts` adds `stuck` — **first** in `POLICY_ORDER`, because a repeated failure is
  also a hard failure — routing to `policy.stuck` (default `mid`) instead of escalating
  forever. `context-pressure` fires only when `contextWindow` is known; unknown context
  can never pick a smaller model by guess (`contextKnown: false` on the proxy path).
- Mod records `repeatedFailure`/`failureStreak`/`contextTokens` per served plan.

**Acceptance:** `policy.test.ts` (stuck and context-pressure rules, unknown-window safety),
`harness.test.ts` (same-failure repeat detection), `sabi-mod.test.ts` (full lifecycle).

## 4. Accounting: compare task outcomes, not repricing (folder-review Important)

- `report.ts`: cached judge usage is counted once per real call (not per cache hit);
  judge cost is reported separately and `netCost` = token cost + judge cost; the all-strong
  counterfactual is labeled `counterfactualType: "estimate"` in JSON and "(rate-only
  estimate)" in the text report.
- `modelSummary` advertises the **policy-reachable** tier set (the tiers `auto` can
  actually pick), not every configured model including `local`.

**Acceptance:** `report.ts` runs against the existing `.sabi/decisions.jsonl` and the
labels/cost fields are present and correct; proxy e2e still passes.

## Not done (deliberately not redundant)

- Context/tool **transformation** (`transformContext`, `setActiveTools`) — the roadmap
  says recommend first, restrict only with evidence, and test in shadow mode. Not
  implemented: no evidence yet, and the current fixes were the named priority.
- Jev for stuck/root-cause — deterministic `repeatedFailure` covers the acceptance check;
  a Jev question was explicitly "only if deterministic misses cases measured in evals".
- Task-aware profiles, learned model profiles, bounded independent review — later
  workstreams; the roadmap gated them behind measured benefit.

## Validation

`npm test` → 90 pass; `npm run typecheck` → clean. Docs updated (`log.md`,
`docs/decisions.md`, `docs/handoff.md`). Nothing committed, pushed or deployed; the
still-running research loop can confirm against the working tree.

## 2026-09-18 follow-up — evals + retry-vs-escalation (from router-learnings)

Acting on the competitive scorecard's "Next evidence, not more features" and the router
learnings' "choose one remaining invariant, add one synthetic failing fixture":

- **Evals harness (`packages/evals`, no runtime deps, no paid calls).** Replays a frozen
  task set through `decideTier` at tool-result boundaries vs a fixed baseline tier;
  reports task pass/fail/blocked, routing by rule/tier, cost, savings, and quality gates.
  `npm run eval`. First measured finding: the deterministic policy over-escalates the
  expected-failure task without Jev (≈4x all-mid cost) — the honest reason the live path
  keeps the judge.
- **Transport vs task failure (router-learnings #7).** New `transport` `FailureLevel` with
  `rate-limited`/`quota-exceeded`/`timeout` codes; `trajectoryFromRound` downgrades a
  tool-reported error to transport when the text is purely transport; `policy.ts` adds a
  `transport` rule (default `mid`) so a 429 retries on the same tier, never escalating;
  the server records upstream 429/5xx as `outcome: 'transport'` and `report.ts` counts
  transports separately.

Acceptance fixtures for both live in the existing `node:test` trees (core state/policy,
harness, mod, proxy, evals). The research loop can confirm against the working tree; the
"not done" list above still holds (context/tool transformation and Jev-for-stuck remain
gated behind measured benefit).

## 2026-09-20 follow-up — evidence-aware scheduler foundation

The supplied arXiv synthesis was converted into the Spec Kit feature at
`specs/001-evidence-aware-scheduler/`. It is explicitly a design input, not independently
reproduced paper evidence or a Sabi benchmark.

- Core now records bounded provenance, verification, coverage and generation state; summaries cannot
  upgrade themselves to verified.
- Recovery planning distinguishes the intervention from the eventual route and grades attribution as
  observed, matched or replayed. Replay is fixture-only and explicit.
- Judge state uses bounded intent/mutation/failure/verification/constraint/prior/context slots with
  omission markers rather than relying only on the last excerpt.
- Controller handoffs carry a bounded recovery capsule; semantic profiling and candidate lifecycle
  are shadow/backtest-only.
- Offline evals expose deterministic holdouts and PRE/LIVE/POST labels; the report separates recovery
  evidence grades and local profile confidence.

Validation: 412 Node tests passed, TypeScript typecheck passed, and the offline eval ran 8 fixture
tasks. No live provider, harness, token receipt, deployment or learned active-route claim is made.
