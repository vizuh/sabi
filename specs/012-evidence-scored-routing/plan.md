# Implementation Plan: Evidence-Scored Routing

**Spec**: [`spec.md`](./spec.md)  
**Branch**: `012-evidence-scored-routing`  
**Date**: 2026-09-24

## Summary

Add an additive evidence-scoring layer (`RouteLevel` L0–L4) on top of the
existing priority-ordered rule cascade. The score is a pure per-round signal
accumulator that maps to a `RouteLevel`, which then resolves to a tier **subject
to the existing hard gates** (transport, stuck, judge veto, capabilities).
Score decay provides automatic de-escalation. This is a new routing *strategy*,
not a replacement for the rule cascade.

## Technical context

- TypeScript 5.9, Node ≥22.6, ESM strict
- Existing packages: `packages/core` (routing, policy, judge, recovery),
  `packages/server` (proxy), `packages/evals` (offline eval)
- The current `decideTier()` in `policy.ts` is the deciding function; the score
  feeds in as an additional signal before the policy is applied, and the policy
  + gates still take precedence.
- Test framework: `node:test` (676 tests, 675 pass, 1 pre-existing failure in
  `controller/inventory.test.ts`).

## Architecture

```
extractTrajectoryState(body)          → TrajectoryState
  │
  ├─ applyMeasuredContext(...)         → state with prior-session context
  │
  ├─ computeEvidenceScore(state,      → EvidenceScore
  │    context, judgeOutcome,           (pure function)
  │    recoveryProfile)
  │
  ├─ mapScoreToRouteLevel(score)        → RouteLevel
  │
  ├─ resolveLevelToTier(level,          → { tier, rule, reason, level }
  │    config, state)                     (respects paid/free, stuck cap)
  │
  ├─ decideTier(state, policy,         → TierDecision  [existing, unmodified]
  │    { exclude, stuckTier })
  │
  └─ [tier may be overridden by       → final RouteDecision
       level resolution, then judge
       gate applies as today]
```

The score layer sits between `extractTrajectoryState` and `decideTier`. If the
score-derived tier differs from the policy tier, the score wins — **unless** a
hard gate (transport, stuck, capabilities) intervenes. The judge gate then runs
on the final tier as it does today.

## Phased approach

### Phase 1: Types and score computation (core, no routing change)

- **T010**: Add `RouteLevel` enum and `EvidenceScore`/`ScoreSignal`/`LevelResolution`
  types to `packages/core/src/types.ts` (additive).
- **T011**: Add `LevelConfig` to `SabiConfig` interface; make it optional.
- **T012**: Implement `computeEvidenceScore(state, context, judgeOutcome?, profile?)`
  in `packages/core/src/scoring.ts` — pure function, deterministic, no I/O.
- **T013**: Implement `mapScoreToRouteLevel(score)` and `resolveLevelToTier(level, config)`
  in `packages/core/src/scoring.ts`. Include the stuck cap (L4 → L3) and
  paid/free fallback (paid tier on free-only upstream → next free tier with
  `rule: 'billing'`).
- **T014**: Unit tests in `packages/core/test/scoring.test.ts` — pure score
  computation, level mapping, gate precedence, decay logic. 20+ tests.

**Checkpoint**: typecheck passes; `scoring.ts` has no imports from router/judge
(it's a leaf module fed by existing types).

### Phase 2: Integration into routing path (core + server)

- **T020**: In `router.ts:route()`, call `computeEvidenceScore` after
  `extractTrajectoryState` + `applyMeasuredContext`. Use the score to suggest
  an initial tier, then pass it through the existing `decideTier()` pipeline
  with the score as a hint (the policy still runs, but if the score says L3
  and the policy says `failure → strong`, both agree; if the score says L0
  and the policy says `failure → strong`, the policy wins because failure is
  a hard signal).
- **T021**: Store `score`, `routeLevel`, and contributing `ScoreSignal[]` on
  the `RouteDecision` (additive fields).
- **T022**: In `server.ts`, persist score/level/signals in the `DecisionRecord`
  (additive — `sanitizeDecisionRecord` already handles unknown optional fields).
- **T023**: Extend `report.ts` to show by-level breakdown and escalation-precision
  (L0→L1, L1→L2, etc.) from the decision log.
- **T024**: Integration tests: feed fixture conversations through `route()` and
  assert the score/level appear on the decision, transport/stuck/judge gates
  still fire correctly.

**Checkpoint**: Full `npm test` passes; existing routing behavior unchanged for
trajectories that don't cross level thresholds.

### Phase 3: Judge integration and de-escalation (core)

- **T030**: `applyJudge()` receives the pre-score level and can bump it (+2
  on confirm) or veto it (drop to deterministic fallback). The judge already
  knows the original/decided tier; now it also sees the score-derived level.
- **T031**: De-escalation decay: when `verification.status === 'passed'` or the
  judge confirms `realProblem ≤ 0.25`, the score for the *next* round starts
  from a decayed baseline (not 0 — the trajectory context may still be
  mid-task). Implement as `carryoverWithDecay(score, signals)`.
- **T032**: Judge tests extended: veto overrides L4→L1, confirm bumps L1→L2,
  ambiguous stays at the deterministic level, shadow question doesn't affect
  routing.

**Checkpoint**: `judge.test.ts` still passes; new tests assert the score/judge
interaction.

### Phase 4: Security signals and file-span detection (core)

- **T040**: Add security/auth/payments patterns to `state.ts` that set a
  `securitySensitive` flag on `TrajectoryState` (or as a new evidence code
  `security-sensitive`).
- **T041**: In `computeEvidenceScore`, weight `security-sensitive` at +5.
- **T042**: Architecture-change detection: count distinct top-level directories
  or modules touched in `lastToolNames` + tool results; if > N, add +3. This
  uses already-parsed tool results, not raw transcript.
- **T043**: Large blast radius: count tool calls in the round; if > N, add +3.
  Uses `transcriptStats.toolMessages`.
- **T044**: Tests for all new signal paths: security, architecture, blast radius.

**Checkpoint**: All new signals fire only on their intended evidence, never on
coincidental text.

### Phase 5: Ensemble L2 support (core, depends on spec 003)

- **T050**: If spec 003 (fanout) is available, L2/FREE_ENSEMBLE activates
  `ensemble: true` in the route decision, triggering parallel candidate
  execution.
- **T051**: If spec 003 is **not** available, L2 degrades to L1
  (`FREE_REASONING`) with `rule: 'degradation'` and a note. L2 never resolves
  to a paid tier.
- **T052**: Disagreement signal: if ensemble models disagree on difficulty
  (one says `trivial`, another says `demanding`), +2 is added to the score.

**Checkpoint**: L2 works with fanout if present, degrades gracefully if absent.

### Phase 6: Paid tier configuration and enforcement (core + config)

- **T060**: Extend `sabi.config.json` schema with optional `levels` block
  mapping RouteLevel → {tier, label, paid?, ensemble?}.
- **T061**: `resolveLevelToTier` checks `servesUpstreamBilling` for paid tiers;
  if the upstream is free-only, fall back to the next lower free level.
- **T062**: Extend the `connect.ts` consent gate (Command Code) to the proxy
  path: a `sabi serve --paid` flag or config opt-in enables paid upstreams.
- **T063**: Tests: paid tier on free-only upstream → billing fallback; paid
  tier on paid-allowed upstream → real paid tier.

**Checkpoint**: No paid model is ever selected on a `paidModelsAllowed: false`
upstream, proven by `ensureRouteCompatible` refusal + resolver fallback.

### Phase 7: Evaluation and convergence

- **T070**: Add escalation-precision fixtures to `packages/evals/src/tasks.ts`:
  each level transition as a frozen task with expected routing.
- **T071**: Extend `packages/evals/src/harness.ts` to report score/level in the
  backtest output.
- **T072**: Run `npm run eval`, compare against the rule-based baseline.
- **T073**: Update `docs/decisions.md`, `docs/handoff.md`, `log.md`.
- **T074**: Full suite: `TMPDIR=/tmp npm test`, `npm run typecheck`,
  `npm run eval`.

## Dependencies

- Phase 1 is self-contained (types + pure scoring).
- Phase 2 needs Phase 1 (types + scoring function).
- Phase 3 needs Phase 2 (judge sees the score from the decision record).
- Phase 4 is independent of 2–3 (signal detection in state.ts) but feeds Phase 1
  tests; can run in parallel.
- Phase 5 depends on spec 003; if 003 is not done, Phase 5 is a no-op
  degradation gate.
- Phase 6 depends on Phase 1 (level resolution) and Phase 2 (decision record).
- Phase 7 needs all previous phases.

## File plan

```
packages/core/src/
├── scoring.ts              # NEW: computeEvidenceScore, mapScoreToRouteLevel, resolveLevelToTier
├── types.ts                # EXTEND: RouteLevel, EvidenceScore, ScoreSignal, LevelConfig, LevelResolution
├── state.ts                # EXTEND: security-sensitive evidence code on TrajectoryState
├── policy.ts               # EXTEND: decideTier accepts optional score hint
├── router.ts               # EXTEND: compute score, store on RouteDecision
├── judge.ts                # EXTEND: applyJudge sees/respects score level
└── compatibility.ts        # UNCHANGED (servesUpstreamBilling already handles paid/free)

packages/core/test/
├── scoring.test.ts         # NEW
├── policy.test.ts          # EXTEND: score-hint interaction
├── judge.test.ts           # EXTEND: score + judge gate
└── state.test.ts           # EXTEND: security signal detection

packages/server/src/
├── server.ts               # EXTEND: score/level on DecisionRecord
├── report.ts               # EXTEND: by-level breakdown
└── passthrough.ts          # UNCHANGED (proxy just forwards)

packages/evals/src/
├── tasks.ts                # EXTEND: escalation-precision fixtures
├── harness.ts              # EXTEND: report score/level
└── backtest.ts             # EXTEND: score-aware comparison

sabi.config.json            # EXTEND: optional `levels` block
```