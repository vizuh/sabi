# Folder review and agent tasks

Read-only source review, 2026-09-18. No runtime changes or live product/evaluation calls.
Recommendations below are not shipped features.

## First conclusion

Prioritize the **Command Code mod**, with the proxy retained for compatibility.
Sabi currently selects models; it does not yet select useful context or tool sets.
The next gain should come from reliable state and fewer wasted rounds, not more judges.

Evidence: local checkout `vizuh/sabi`, HEAD observed during review:
`575c34cb5744a291b2c72595cfa187e90c457155`. The checkout contained concurrent
implementation edits at intake. File references describe the inspected working tree,
not remote delivery. Historical test/live-run claims were not rerun in this review.

## `packages/core` — useful baseline, incomplete trajectory state

- `src/policy.ts`: ordered deterministic tier rules. Cheap to evaluate and easy to audit.
- `src/state.ts`: classifies the **previous tool call**, not the difficulty of the next inference.
  Reading a complex security-sensitive file can therefore select the exploration tier.
- `src/harness.ts`: explicit tool error signals beat error-looking text. Good direction;
  an execution error still does not prove that a stronger model is needed.
- `src/judge.ts`: semantic checks exist for proxy failure/unclassified rounds only.
- Missing: available-model eligibility, context-fit checks, actual next-step intent,
  repeated-failure history, downgrade damping, and remaining-budget inputs.

**Next agent:** add replay cases for read→hard reasoning, expected failure, mixed
read/edit batches, permission denial, and repeated failures. Do not infer correctness
from a rule name or from Jev confidence. Preserve deterministic fallback.

## `packages/adapters/command-code` — preferred integration

- `mod/sabi.ts`: uses `prepareNextTurn`, `afterToolCall`, `onTurnEnd`, and model events.
  Model and effort selection occur on continuing rounds; round one keeps the host selection.
- Its `contextChars` only accumulates string tool results. It does not measure the full
  request, tool schemas, system prompt, or compaction. `toolNames`/`hasTools` are read
  from the ledger but never populated from the host by this mod.
- `lastUsage` and `servedBy` can carry old values when a new event/usage value is absent.
  Treat this as an attribution risk until replayed against the real lifecycle.
- `minPlan` is descriptive, not enforced. The shared config validator validates proxy
  tiers but does not validate `harness.tiers` as an independent routing catalog.
- The mod does not call Jev, filter tools, or transform context. Its log uses host custom
  entries; the proxy report does not read these entries.
- `types/commandcode-harness.d.ts` is a local shim, not proof of runtime compatibility.

**Next agent:** build an installed-contract replay fixture first. Cover two user runs,
resume, compaction, unavailable tiers, missing usage, and actual vs planned model.
A concurrent implementation handoff now records a successful two-round live smoke
run. That claim was not rerun here; broader lifecycle validation is still needed.

## `packages/server` — compatibility path, accounting and privacy gaps

- `src/server.ts`: local OpenAI-compatible endpoint, optional remote Jev, streamed upstream.
- `src/report.ts`: reprices observed tokens against an all-strong rate. This is **not**
  a measured all-strong run; it cannot establish equal task success or actual savings.
  Judge cost is reported separately and is not subtracted in `savingsPct`.
- `src/typesafe.ts`: cached judge results retain token usage; the report sums it again
  on cache hits. Retry accounting and one end-to-end cancellation deadline need review.
- `src/server.ts:modelSummary` uses all configured model windows, while the provider
  writer uses policy-reachable tiers. These can advertise different adaptive limits.

**Critical before exporting logs:** `state.ts:snippet` captures tool-output excerpts;
`policy.ts` includes them in reasons; `server.ts` persists state and upstream error text.
The mod also stores reasons/evidence. The claim “never prompt content” is too strong.
Keep existing raw logs local. Use allowlisted reason codes and synthetic canary tests
before sharing telemetry. No real logs or credentials were read for this review.

## `docs` — correct the entry points, preserve historical evidence

- At intake, README/context/handoff emphasized proxy-only operation and old counts.
  A concurrent session updated README/handoff and added bilingual installation docs
  during this review. Recheck current files before acting; do not revert that work.
- `docs/decisions.md` records the newer two-adapter direction.
- `AGENTS.md` still describes code as unscaffolded. Record this drift; do not treat the
  old statement as evidence that packages do not exist.
- The named attachment `Pasted markdown(20260918-092817).md` was not found in the repo
  or top-level Downloads. The supplied chat text was used; its benchmark claims were
  not independently verified and are not Sabi acceptance evidence.

## Ready-to-post issue comments

GitHub read on 2026-09-18: `vizuh/sabi` is private; no open or closed issues were
returned (`gh issue list --state all --limit 100`). No existing issue could receive
comments. No issue was created or posted. These blocks are handoffs for the next agent.

### Critical — telemetry is not content-free

Observed paths: `state.ts` → `policy.ts` → `server.ts`, and `mod/sabi.ts` custom entries.
Action: define one allowlisted decision record shared across transports; omit output
snippets and raw provider errors by default. Acceptance: synthetic secret-like markers
in prompts, tool output and errors appear in neither logs, reports nor `/decisions`.
Keep any diagnostic-content capture explicitly opt-in and local.

### Important — validate the mod before tuning policy

Action: replace partial counters with verified host observations; bind plans, usage
and actual served models to the same round; validate eligible tiers and unknown states.
Acceptance: offline lifecycle tests cover round one, continuation, a second user run,
resume, compaction, mixed tool results, missing usage and unavailable models without
stale attribution or silent privilege/budget escalation.

### Important — compare task outcomes, not token repricing

Action: separate mod/subscription accounting from proxy/API accounting; deduplicate
cached judge usage and count retries, reviews and escalation. Acceptance: controlled
fixed-policy comparisons report completed-task success, total usage/cost, latency,
unknown usage and cache behavior. Label rate-only counterfactuals as estimates.
