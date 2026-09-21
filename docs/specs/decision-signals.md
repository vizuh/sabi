# Decision signals

Status: Phase 1 implemented (`packages/core/src/signal-producers.ts` +
`packages/core/test/signal-producers.test.ts`). Deterministic shadow producers with a
parity battery against the current policy rules. Routing still untouched.

## Problem

`TrajectoryState` is flat and `decideTier` is first-match: every new judgment becomes
another rule or another field, and the tier carries both the intervention choice and the
model choice. The VNext spec already requires intervention-before-candidate; signals are
the seam that makes that compositional instead of additive.

## Primitive

One `DecisionSignal`: `{ id, kind, value, confidence, sessionId, operationId?, roundId?,
source, evidence[], dependsOn?, supersedes?, observedAt, expiresAt?, mode }`.
Evidence is `{ kind, id }` references only — never raw text — so signals stay inside the
allowlist-only telemetry contract. The kind set is closed (`KNOWN_SIGNAL_KINDS`, twelve
kinds); extending it needs a spec entry and a test, or kinds proliferate exactly like
rules did.

## Phase 1 — deterministic producers (implemented)

`deterministicSignals(state, scope)` translates ground truths the code already owns
into shadow signals at confidence 1.0: `failure.transport` (classifier output),
`failure.real` (only on `tool-error` evidence or an explicitly clean round — fuzzy
text-derived failures stay absent for the Jev phase), `progress.stalled`
(`repeatedFailure`), `verification.complete` (verification rounds only),
`context.pressure` (measured tokens/window ratio, absent when unknown),
`context.staleness` (observed host rewrite). Absence means "not observed", never
"false". A parity battery asserts each signal tracks its policy rule exactly
(transport, 0.9-thresholded pressure, stuck), so future refactors cannot silently
diverge the two. Signal ids are `${kind}:${roundId ?? 'live'}`: recomputation
overwrites rather than duplicates.

## Store bounds

Per `(sessionId, operationId)` scope: at most 64 signals, 5-minute max age, prune on
insert. Superseded signals are flagged, never deleted. Time is injected. A 10x synthetic
trace run must show bounded memory before any phase wires signals into routing.

## Lineage

`explainSignal` renders `decision (confidence) → because: <parent signals> → which
depended on: <event refs>`. Unknown ids render as-is. This is the future answer to
"why did you switch models" and the only explainability surface planned.

## Deliberately unimplemented (measured later, not now)

- Join semantics (`intervention`, `route` inputs) — Phase 3, after backtesting joins
  against the decision log.
- `minConfidence`, `maxDecisionHops`, cycle guards, stale-signal policy — placeholders
  until Phase 4 measures them. No magic numbers ship without data.
- Batched multi-question Jev → signals split — Phase 2, with latency/cost gates.
- Free-model micro-judges and model×judgment profiles — Phases 5–6, shadow-only per
  the VNext non-goals (no auto-promotion).
- `apply` mode is stored, never enforced, until Phase 4's single-harness trial with a
  kill switch.

## Acceptance gates for later phases

Focused unit tests per transition; deterministic evals (PRE/LIVE/POST + held-out);
bounded-memory trace; no cost claim without measured price+usage; live claims need a
pinned runtime and an approved free/paid boundary. Same gates as the VNext spec —
signals do not lower the bar.
