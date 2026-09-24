# Tasks: Evidence-Scored Routing

**Input**: [`spec.md`](./spec.md), [`plan.md`](./plan.md)

## Phase 1: Types and score computation (core, no routing change)

- [ ] T010 Add `RouteLevel` enum and `EvidenceScore`/`ScoreSignal`/`LevelResolution`
  to `packages/core/src/types.ts` (additive fields only).
- [ ] T011 Add `LevelConfig` to `SabiConfig` interface; make it optional.
- [ ] T012 Implement `computeEvidenceScore(state, context, judgeOutcome?, profile?)`
  in `packages/core/src/scoring.ts` — pure, deterministic, no I/O.
- [ ] T013 Implement `mapScoreToRouteLevel(score)` and
  `resolveLevelToTier(level, config)` in `scoring.ts`. Stuck cap (L4→L3)
  and paid/free fallback (`rule: 'billing'`).
- [ ] T014 Unit tests in `packages/core/test/scoring.test.ts`: pure score,
  level mapping, gate precedence, decay. 20+ tests.

**Checkpoint**: typecheck passes; `scoring.ts` has no imports from router/judge.

## Phase 2: Integration into routing path (core + server)

- [ ] T020 In `router.ts:route()`, call `computeEvidenceScore` after trajectory
  state extraction; use score as a hint alongside `decideTier()`.
- [ ] T021 Store `score`, `routeLevel`, and `ScoreSignal[]` on `RouteDecision`
  (additive fields).
- [ ] T022 Persist score/level/signals in `DecisionRecord` via
  `server.ts:saveDecision` + `sanitizeDecisionRecord`.
- [ ] T023 Extend `report.ts`: by-level breakdown + escalation-precision
  (L0→L1, L1→L2, etc.).
- [ ] T024 Integration tests: fixture conversations through `route()`; assert
  score/level on decision, transport/stuck/judge gates still fire.

**Checkpoint**: `npm test` passes; existing routing behavior unchanged when
score doesn't cross thresholds.

## Phase 3: Judge integration and de-escalation (core)

- [ ] T030 `applyJudge()` receives pre-score level; can bump (+2 confirm) or
  veto (drop to deterministic fallback).
- [ ] T031 De-escalation decay: `carryoverWithDecay(score, signals)` — score
  drops by ≥4 on `verification.status === 'passed'`, ≥3 on judge approval.
- [ ] T032 Extend `judge.test.ts`: veto overrides L4→L1, confirm bumps L1→L2,
  ambiguous stays deterministic, shadow question doesn't affect routing.

**Checkpoint**: all judge tests pass; new tests assert score/judge interaction.

## Phase 4: Security signals and file-span detection (core)

- [ ] T040 Add `security-sensitive` evidence code to `state.ts`; detect in
  `detectFailure` / `buildJudgeEvidence`.
- [ ] T041 Weight `security-sensitive` at +5 in `computeEvidenceScore`.
- [ ] T042 Architecture-change detection: distinct top-level paths in tool
  results → +3.
- [ ] T043 Large blast radius: tool-call count > N → +3.
- [ ] T044 Tests: security, architecture, blast-radius signals fire only on
  intended evidence.

**Checkpoint**: signals never fire on coincidental text (allowlisted codes
only, no raw excerpt inspection for scoring).

## Phase 5: Ensemble L2 support (core, depends on spec 003)

- [ ] T050 If spec 003 fanout exists, L2/FREE_ENSEMBLE activates `ensemble: true`.
- [ ] T051 If spec 003 absent, L2 degrades to L1 (`rule: 'degradation'`).
- [ ] T052 Disagreement signal: ensemble models disagree on difficulty → +2.

**Checkpoint**: L2 degrades gracefully when fanout is unavailable; never
resolves to paid.

## Phase 6: Paid tier configuration and enforcement (core + config)

- [ ] T060 Add optional `levels` block to `sabi.config.json` schema.
- [ ] T061 `resolveLevelToTier` checks `servesUpstreamBilling`; free-only
  upstream → next free level with `rule: 'billing'`.
- [ ] T062 Extend consent gate (`connect.ts`) to proxy: `--paid` flag or
  config opt-in.
- [ ] T063 Tests: paid tier on free-only upstream → billing fallback.

**Checkpoint**: no paid model selected on `paidModelsAllowed: false`, proven by
`ensureRouteCompatible` refusal + resolver fallback.

## Phase 7: Evaluation and convergence

- [ ] T070 Add escalation-precision fixtures to `packages/evals/src/tasks.ts`.
- [ ] T071 Extend `packages/evals/src/harness.ts` to report score/level.
- [ ] T072 Run `npm run eval`, compare vs. rule-based baseline.
- [ ] T073 Update `docs/decisions.md`, `docs/handoff.md`, `log.md`.
- [ ] T074 Full suite: `TMPDIR=/tmp npm test`, `npm run typecheck`,
  `npm run eval`.

## Parallel tracks

- Phase 4 (security/architecture/blast-radius signals) can run in parallel
  with Phase 2, since it only extends `TrajectoryState` with new evidence codes
  that `computeEvidenceScore` reads.
- Phase 5 (ensemble) is gated on spec 003 completion; if 003 is not done by
  phase start, T051 (degradation gate) is implemented as a no-op L2→L1 fallback.
- Phase 6 (paid config) can start once T010 types are in place; it does not
  depend on the full routing integration.

## Dependencies

- Phase 1 blocks all code phases.
- Phase 2 needs Phase 1.
- Phase 3 needs Phase 2 (judge reads score from decision record).
- Phase 4 is independent of 2–3 but feeds Phase 1 tests.
- Phase 5 depends on spec 003.
- Phase 6 needs Phase 1 (level resolution).
- Phase 7 needs all previous phases.