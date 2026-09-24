# Feature Specification: Evidence-Scored Routing

**Feature Branch**: `012-evidence-scored-routing`

**Created**: 2026-09-24

**Status**: Planned

**Input**: The user-defined escalation scoring model (RouteLevel L0–L4 with
additive signal weights, score-to-tier thresholds, automatic de-escalation)
mapped against the existing deterministic rule-based router in
`packages/core/src/policy.ts` (`decideTier`), `packages/core/src/judge.ts`,
`packages/core/src/recovery-actions.ts`, and `packages/core/src/recovery.ts`.

## Context: what already exists

- **Tier-based routing** (`policy.ts`, `router.ts`): 4 named tiers
  (`cheap`, `mid`, `strong`, `local`) selected by a priority-ordered rule
  cascade (`POLICY_ORDER`: stuck → failure → context-pressure → transport →
  first-turn → verification → implementation → exploration → unclassified).
  The first matching condition wins; `stuck` is checked *before* `failure`, so
  repeated hard failures route to `mid` (an investigation zone), never to
  `strong`.
- **Hard deterministic gates** (`state.ts:194`): `FailureLevel` is
  `'none' | 'soft' | 'hard' | 'transport'`. Transport signals (rate-limited,
  quota-exceeded, timeout, 429) are detected *before* hard patterns and route
  to `policy.transport: "mid"`, never escalating.
- **Judge gate** (`judge.ts`): Jev is consulted on `failure` and `unclassified`
  rounds only. `realProblem ≤ 0.25` vetoes escalation (drops to the
  deterministic fallback); `realProblem ≥ 0.6` confirms it; the ambiguous band
  (0.25–0.6) is resolved by local recovery-rate data (Wilson CI, n≥30 gate).
- **Recovery rate** (`recovery.ts`): Per-session two-round recovery attribution
  produces a `RecoveryProfile` used as the ambiguous-band tie-breaker.
- **Free-only enforcement** (`compatibility.ts:92-105`):
  `servesUpstreamBilling()` refuses any non-zero-cost model on an upstream with
  `paidModelsAllowed: false`. The current `sabi.config.json` sets this on the
  OpenRouter upstream, so all tiers default to `:free` models.
- **Recovery actions** (`recovery-actions.ts`): `escalate-model` fires only on
  the *first* hard failure; `repeatedFailure` triggers `fresh-context` or
  `rollback-with-reflection`, never another escalation.
- **Cache-aware routing** (`cache-routing.ts`): Same-tool-cycle pinning
  preserves cache hits; cost-aware `switch` evaluates expected gain vs.
  reprocess penalty (cost-only signal, no quality guess).

## What is new

The evidence-scored routing layer adds a **numeric signal accumulator** that
aggregates trajectory evidence into a score, maps it to a `RouteLevel`
(L0–L4), and uses that level as the initial tier suggestion — **subject to
the existing hard gates** (transport, stuck, capabilities, judge veto). The
score system does not replace the rule cascade; it augments it with graded
signals where the current binary conditions cannot distinguish degrees of
difficulty.

### RouteLevel enum

```ts
enum RouteLevel {
  FREE_FAST = 0,      // mechanical / deterministic
  FREE_REASONING = 1,  // easy reasoning, low-risk
  FREE_ENSEMBLE = 2,   // ambiguous but recoverable (multi-model consensus)
  PAID_MID = 3,        // failure evidence / high uncertainty
  PAID_STRONG = 4,     // critical / deeply complex / repeated failure
}
```

### Escalation score

Computed per round from `TrajectoryState` plus the `RouteContext` continuity
signals (previous failure, streak, recovery profile). The score is
**additive within a round** and **decays per round** when positive signals
appear (de-escalation is automatic, not permanent).

| Signal | Weight | Source |
|---|---|---|
| `failure` (hard evidence) | +3 | `state.ts:detectFailure` → `state.failure === 'hard'` |
| `repeatedFailure` (same failure signature, streak ≥ 2) | +4 | `state.ts:336-342` + `recovery.ts:failureSignature` |
| Judge rejects an escalation (jev veto, `realProblem ≤ 0.25`) | +3 | `judge.ts:371-379` |
| Judge confirms escalation (`realProblem ≥ 0.6`) | +3 | `judge.ts:380-381` |
| High uncertainty: judge ambiguous band + no decisive profile | +2 | `judge.ts:382-416` (ambiguous, not declined) |
| Model disagreement: multiple free tiers produce conflicting judge difficulty | +2 | new — see FR-006 |
| Security/auth/payments/data-loss risk in failure evidence | +5 | `state.ts:HARD_PATTERNS` + new pattern set |
| Architecture change: edits span > N modules or touch > N files | +3 | `evidence.ts:'mutation'` + file-span count |
| Large blast radius: > N tool calls in the round, or > N changed files | +3 | `state.ts:transcriptStats` |
| Context pressure (≥90% of window) | +2 | `policy.ts:39` |
| Tool call failure (`tool-error` evidence) | +2 | `evidence.ts:EVIDENCE_CODES` |

| De-escalation signal | Weight | Source |
|---|---|---|
| Successful verification (`verification.status === 'passed'`) | −4 | `evidence.ts:deriveVerificationState` |
| Judge approval of a round (`realProblem ≤ 0.25` on a `failure` rule) | −3 | `judge.ts:372-378` |
| Simple task: roundKind `exploration` or `verification` clean | −2 | `state.ts:roundKind` |
| Mechanical work: no tool calls, text-only, < N tokens | −3 | `state.ts:transcriptStats` |

### Score → RouteLevel mapping

```
score ≤ 2      → FREE_FAST     (L0)
3–5            → FREE_REASONING (L1)
6–7            → FREE_ENSEMBLE  (L2)
8–10           → PAID_MID       (L3)
11+            → PAID_STRONG    (L4)
```

### RouteLevel → tier resolution

The `RouteLevel` is a **suggestion**. The existing policy gates remain
authoritative:

1. **Transport gate always wins**: if `state.failure === 'transport'`, the
   score is set to 0 and the tier is `policy.transport` (`mid`), regardless of
   accumulated score. A rate-limit is never evidence of reasoning difficulty.
2. **Stuck cap**: if `state.repeatedFailure === true`, the max reachable level
   is `PAID_MID` (L3). The `stuck` rule prevents escalation to `PAID_STRONG`
   on repeated failure — the trajectory gets `fresh-context` or `rollback`
   instead of another stronger model.
3. **Judge veto overrides score**: if Jev says `realProblem ≤ 0.25` on a
   `failure` decision, the level drops to the deterministic fallback tier
   (typically L1/MID at most), even if the score was L4.
4. **Judge confirm upgrades within level**: if Jev confirms `realProblem ≥ 0.6`,
   the score is bumped by +2 (but subject to the stuck cap).
5. **Capability/mode gates**: `ensureRouteCompatible` and modality checks still
   refuse a tier that cannot serve the round's modality or output ceiling.

### Tier configuration

The score maps to concrete tiers via `sabi.config.json`:

```json
{
  "levels": {
    "0": { "tier": "cheap",  "label": "FREE_FAST" },
    "1": { "tier": "mid",    "label": "FREE_REASONING" },
    "2": { "tier": "cheap",  "label": "FREE_ENSEMBLE", "ensemble": true },
    "3": { "tier": "strong", "label": "PAID_MID", "paid": true },
    "4": { "tier": "strong", "label": "PAID_STRONG", "paid": true }
  }
}
```

- L2/FREE_ENSEMBLE routes to `cheap` with `ensemble: true`, triggering
  parallel model fanout (depends on spec 003) for disagreement detection.
- L3/L4 require a paid-capable upstream. An upstream with
  `paidModelsAllowed: false` causes the resolver to fall back to the next
  highest level whose tier is free — a config mistake cannot spend money.
- The consent gate (`connect.ts`) already exists for Command Code
  registration; the proxy path gains an equivalent `paidModelsAllowed`
  opt-in per upstream.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Escalate on accumulating evidence (Priority: P1)

As a routing system, I need the score to climb when evidence of difficulty
accumulates across a trajectory, so cheap models are tried first and paid
intelligence only arrives when evidence warrants it.

**Why this priority**: This is the core cost-control contract — "paid
intelligence is an escalation resource, not the default execution
environment."

**Independent Test**: Feed a fixture trajectory through `computeEvidenceScore`
with staged failures, judge vetoes, and successful verifications; assert the
score rises and falls as expected and stays within the stuck cap.

**Acceptance Scenarios**:

1. **Given** a single hard failure with judge confirmation, **when** the score
   is computed, **then** it is ≥ 6 (L2) but the tier resolves to the paid
   fallback only if the upstream allows paid, otherwise stays at the highest
   free tier.
2. **Given** a repeated failure (streak 2), **when** the score is computed,
   **then** it is ≥ 11 (L4) but `decideTier` caps the tier at L3 (`strong`) due
   to the stuck rule.
3. **Given** a transport error (429) following a hard failure, **when** the
   score is computed, **then** transport evidence is ignored and the score
   comes only from the hard-failure signal.

### User Story 2 - De-escalate when evidence resolves (Priority: P1)

As a routing system, I need the score to decay when verification passes or
the judge approves, so paid models are only used while the problem is active.

**Why this priority**: Without de-escalation, the score is a one-way ratchet
that locks every round into the expensive tier — the exact anti-pattern the
user vision targets.

**Independent Test**: Start from a high score (L4) and feed a passing
verification receipt + judge approval; assert the score drops below the L3
threshold within one round.

**Acceptance Scenarios**:

1. **Given** score at 11 (L4) and `verification.status === 'passed'`, **when**
   the next round is scored, **then** the score drops by ≥ 4 (to ≤ 7, L2).
2. **Given** score at 8 (L3) with judge approval (`realProblem ≤ 0.25`),
   **when** the next round is scored, **then** the score drops by ≥ 3 (to ≤ 5,
   L1).
3. **Given** a mechanical round (no tool calls, < 500 tokens, text-only),
   **when** the score is computed, **then** the score drops by 3 and the tier
   resolves to `cheap` regardless of prior accumulation.

### User Story 3 - Judge veto overrides accumulated score (Priority: P1)

As a routing system, I need the judge's veto to take precedence over a high
escalation score, so false-positive failures don't lock in expensive rounds.

**Why this priority**: The judge gate is the last deterministic line of
defense; the score must never bypass it.

**Independent Test**: Seed a score at L4, apply a judge veto (`realProblem ≤
0.25`), and assert the resolved tier is the deterministic fallback, not the
paid strong tier.

**Acceptance Scenarios**:

1. **Given** score 11 (L4) on a `failure` rule and judge `realProblem: 0.05`,
   **when** `applyJudge` runs, **then** the tier drops to L1 (`mid`) with
   `note: 'escalation vetoed'` and `direction: 'down'`.
2. **Given** judge is unavailable (timeout/error), **when** a score-based
   escalation was proposed, **then** the routing falls back to the deterministic
   policy tier, never to a paid tier without confirmation.

### User Story 4 - Free-only enforcement prevents accidental paid spend (Priority: P1)

As an operator, I need the paid tiers to be a no-op when the upstream
disallows paid models, so a misconfigured score cannot spend money.

**Why this priority**: The current `sabi.config.json` sets
`paidModelsAllowed: false` on OpenRouter; the scoring system must respect
this, not bypass it.

**Independent Test**: Configure a tier as `paid: true` on a free-only upstream
and assert `servesUpstreamBilling` refuses the route; assert the resolver
falls back to the highest free tier.

**Acceptance Scenarios**:

1. **Given** L3 (PAID_MID) resolved to a paid model on an upstream with
   `paidModelsAllowed: false`, **when** `ensureRouteCompatible` runs, **then**
   it throws `SabiRouteError` and the resolver picks the next free tier.
2. **Given** all tiers are paid-only and the upstream is free-only, **when**
   routing, **then** the proxy returns 400 and the mod falls back to the
   harness's native model.

### User Story 5 - Ensemble disagreement drives escalation (Priority: P2)

As a routing system, I need L2 (FREE_ENSEMBLE) to run multiple free models in
parallel and use their disagreement as an escalation signal.

**Why this priority**: Model disagreement is one of the strongest cheap-to-free
signals that a problem is genuinely hard, and it maps directly to the L2→L3
transition the user vision identifies as the key boundary.

**Independent Test**: With a mock fanout (spec 003), feed two models that
disagree on a tool call result and assert the disagreement signal fires; feed
two models that agree and assert it does not.

**Acceptance Scenarios**:

1. **Given** L2 resolves to `ensemble: true` and two free models produce
   divergent difficulty assessments, **when** the round is re-scored, **then**
   the disagreement signal (+2) pushes the score toward L3.
2. **Given** L2 ensemble and the models agree, **when** the round is re-scored,
   **then** no disagreement bonus is added.
3. **Given** no fanout capability is configured (spec 003 not yet built),
   **when** L2 is selected, **then** it degrades to L1 (`FREE_REASONING`) on the
   single best free model, never to a paid tier.

### User Story 6 - Security-sensitive evidence triggers immediate escalation (Priority: P2)

As a routing system, I need security/auth/payments/data-loss signals to
immediately push the score to L3 or above, so cheap models never own risky
decisions.

**Why this priority**: These are the strongest escalation signals in the user's
table (+5) and the most dangerous to leave on a free model.

**Independent Test**: Feed failure evidence containing auth/permission/security
patterns and assert the score receives the +5 bonus; feed a normal failure and
assert it does not.

**Acceptance Scenarios**:

1. **Given** `failureEvidence` includes `permission-denied` or
   `security-sensitive`, **when** the score is computed, **then** the score
   receives +5 and resolves to at least L3.
2. **Given** a transport error with no security signal, **when** the score is
   computed, **then** the +5 bonus does not fire.

## Edge Cases

- A round has both a hard failure and a transport error in the same text —
  transport wins (detected first in `detectFailure`), the hard-failure score
  signal is suppressed.
- The judge returns an invalid or unknown difficulty — the score does not
  receive the confirmation/demotion bonus; it stays at the deterministic level.
- Repeated failure is detected but no clean point exists for rollback — the
  score may be high (L4) but the recovery action is `fresh-context`, and the
  stuck cap keeps the tier at L3.
- The config has no paid tiers and the score reaches L3/L4 — the resolver
  falls back to the highest free tier (`strong`) and logs a `billing` fallback
  rule.
- Score decays to 0 mid-trajectory on a mechanical round but the next round is
  a hard failure — the score rises again from 0; there is no momentum carry.
- Ensemble fanout is requested but no catalog of free models with tool
  support is available — L2 degrades to L1 silently with a `rule: 'capability'`
  note.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST define a `RouteLevel` enum (L0–L4) with stable string
  labels and numeric ordinals that map to tier configurations in
  `sabi.config.json`.
- **FR-002**: Sabi MUST compute an additive evidence score from
  `TrajectoryState`, `RouteContext`, `JudgeOutcome`, and `RecoveryProfile` on
  every auto-routed round, using the signal weights in §Signal weights.
- **FR-003**: The score MUST decay each round when positive signals appear
  (verification passed, judge approval, mechanical work), never carrying
  indefinitely across unrelated tasks.
- **FR-004**: The score-to-tier resolution MUST respect the existing hard gates
  in order: transport exclusion → stuck cap → judge veto/confirm → capability
  gates. A higher score never overrides a lower gate.
- **FR-005**: A `RouteLevel` that requires a paid tier on a
  `paidModelsAllowed: false` upstream MUST resolve to the highest available
  free tier and MUST NOT throw to the user; the fallback is recorded as
  `rule: 'billing'`.
- **FR-006**: L2/FREE_ENSEMBLE MUST support parallel model fanout when
  capability is declared; without it, L2 degrades to L1.
- **FR-007**: Security-sensitive, auth, payments, and data-loss signals MUST
  carry a +5 weight and MUST trigger escalation to at least L3 regardless of
  other signals.
- **FR-008**: The `DecisionRecord` MUST persist the computed score, the
  resolved `RouteLevel`, and every signal that contributed to it, so the report
  can analyze escalation precision.
- **FR-009**: `npm run eval` MUST include escalation-precision fixtures for
  each level transition (L0→L1, L1→L2, L2→L3, L3→L4, and de-escalation paths),
  with the existing expected-failure and rate-limit tasks as regression gates.

### Non-Functional Requirements

- **NFR-001**: `computeEvidenceScore` MUST be a pure function with
  deterministic output for identical inputs — no randomness, no live I/O.
- **NFR-002**: The score computation MUST add no more than 1% median overhead
  to the existing routing path (which must remain ≤ 10% vs. the pre-feature
  baseline per NFR-003 of spec 001).
- **NFR-003**: No test or fixture may require paid provider inference, live
  credentials, or unlabelled external data.
- **NFR-004**: Existing `decisions.jsonl` schema MUST remain backward
  compatible; score/level fields are additive and optional.

### Key Entities

- **RouteLevel**: Enum {FREE_FAST(0), FREE_REASONING(1), FREE_ENSEMBLE(2),
  PAID_MID(3), PAID_STRONG(4)}.
- **EvidenceScore**: An integer in the range [-∞ .. +∞], computed per round.
  Negative scores are clamped to 0 (L0).
- **ScoreSignal**: A {signal, weight, source} record contributing to the score.
- **LevelResolution**: The result of mapping a score + gates to a tier:
  {level, tier, resolvedBy, fallbackReason?}.
- **LevelConfig**: Per-level tier mapping in `sabi.config.json`:
  {tier, label, paid?, ensemble?}.

## Success Criteria *(mandatory)*

- **SC-001**: All new scoring fixtures pass (level transitions, de-escalation,
  judge veto override, transport exclusion, stuck cap, paid/free fallback);
  zero regressions in the existing 676-test suite.
- **SC-002**: For identical fixture inputs, `computeEvidenceScore` and
  `resolveRouteLevel` produce byte-for-byte identical output across repeated
  runs.
- **SC-003**: 100% of paid-tier `RouteLevel` resolutions on a free-only
  upstream resolve to a free tier with `rule: 'billing'`; no paid model is
  ever selected on `paidModelsAllowed: false`.
- **SC-004**: The stuck cap is enforced: repeated failure at L4 resolves to L3
  (`strong`), never L4, and the `DecisionRecord.recovery.action` is
  `fresh-context` or `rollback`, never `escalate-model` for the second failure.
- **SC-005**: De-escalation is observed: after a passing verification, the score
  drops by ≥ 4 points and the resolved tier is ≤ L1, within one round.
- **SC-006**: The escalation-precision fixtures in `npm run eval` show no
  regression versus the current rule-based baseline on the expected-failure
  and rate-limit tasks.

## Assumptions

- The existing TypeScript/Node packages, decision log, judge gate, and
  recovery profile remain the implementation base.
- Paid model tiers require a separate upstream declaration with
  `paidModelsAllowed: true` and explicit per-model cost entries; the scoring
  system never invents a paid provider.
- L2/ensemble fanout reuses the candidate fanout primitives from spec 003;
  if spec 003 is not yet implemented, L2 degrades to L1.
- The `RouteLevel` is a routing suggestion layer; the host harness keeps its
  own loop and credential. Paid models only run when the operator or the
  host's subscription explicitly enables them.
- The score is computed from trajectory *evidence* (codes, not excerpts); raw
  prompt/tool text never enters the scoring function.

## Out of Scope

- Training or fine-tuning a scoring model.
- Automatic policy promotion from production logs.
- Implicit replay of live user tasks or destructive commands.
- Replacing the judge gate or the hard deterministic recovery precedence
  (transport, stuck, capabilities).
- Adding a new paid provider solely to prove the feature.
- Cross-session score persistence (the score is per-session, reset on clean
  context)