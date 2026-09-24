# Feature Specification: Verified Candidate Fanout

**Feature Branch**: `003-verified-candidate-fanout`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Simplicio-material synthesis (MCTS-style speculative branches decided
by deterministic verification) mapped against `docs/specs/surplus-inference.md`
(review-only first slice), `docs/specs/surplus-council.md` (spec-only ledger and
promotion gates), and spec 002 (receipts + capabilities + isolation contracts).

## Context: what already exists

- Surplus inference uses fixed zero-cost aliases for read-only review
  (`sabi surplus review --intent=bug-hunt|test-gap|api-contract`); claims are
  advisory, `verifiedClaimCount` is always 0, no fan-out or automatic influence.
- The council/ledger design (multi-alias seats, budgets, promotion gates) is
  spec-only, explicitly "no fan-out, debate, ranking, or automatic primary-task
  influence."
- 001 recovery vocabulary and 002 `isolatedWorkspaces` capability plus
  `ExecutionReceipt` give the preconditions: bounded candidates, isolated
  execution, receipt arbitration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Try cheap candidates, let the verifier decide (Priority: P1)

As a user with a failed or stuck task, I need Sabi to run 2–3 bounded candidate
branches on free/cheap models in isolated workspaces and promote only the one
a deterministic verifier confirms, so the expensive model intervenes only when
cheap search plus verification fails.

**Why this priority**: This is the core economic inversion — the strong model
stops being the default creator and becomes the fallback intervener.

**Independent Test**: Fixture planner emits a fanout plan (branches, models,
isolation, verifier, budgets); fixture arbiter consumes fabricated candidate
receipts and selects the verified winner; assert losers are discarded with
receipts and no promotion without a `passed` receipt.

**Acceptance Scenarios**:

1. **Given** a failed implementation and two eligible free aliases plus
   isolation, **when** fanout is planned, **then** the plan has ≤3 branches,
   free-only models, a required verifier, and per-branch attempt budgets.
2. **Given** one candidate with a `passed` receipt and one with `failed`,
   **when** arbitration runs, **then** the verified candidate wins and the
   loser’s receipt is retained for the episode record.
3. **Given** no candidate with a `passed` receipt, **when** arbitration runs,
   **then** the outcome is `escalate-model` with the fanout receipts attached
   as evidence — never a silent pick of the least-bad candidate.

---

### User Story 2 - Keep fanout safe by construction (Priority: P1)

As a user trusting Sabi with my repository, I need fanout to run only in
declared isolated workspaces, with read/write constraints, attempt caps, and
no destructive commands, so speculative work cannot corrupt the primary tree.

**Why this priority**: Speculative execution without isolation is a data-loss
vector; safety must be structural, not advisory.

**Independent Test**: Feed plans with missing isolation, over-broad write
scopes, and destructive command shapes; assert the planner refuses each with
an explicit reason and falls back to a safe action.

**Acceptance Scenarios**:

1. **Given** `isolatedWorkspaces: false/unknown`, **when** fanout is
   considered, **then** it is refused and the planner records the missing
   capability.
2. **Given** a candidate patch touching paths outside the declared scope,
   **when** arbitration runs, **then** the candidate is disqualified regardless
   of verifier output.
3. **Given** a destructive command shape in a candidate plan, **when** safety
   screening runs, **then** the branch is refused before execution — matching
   the 001 no-implicit-replay boundary.

---

### User Story 3 - Graduate surplus reviewers into candidate workers (Priority: P2)

As a maintainer with surplus zero-cost capacity, I need replayable operations
to use surplus aliases as candidate workers under verifier arbitration —
not just reviewers — while non-replayable operations keep the review-only
boundary.

**Why this priority**: Connects the existing surplus slice to real execution
verification; free models become producers under deterministic judgment.

**Independent Test**: Classify fixture operations as replayable or not; assert
workers are assigned only to replayable ones with verifier arbitration, and
review-only behavior is unchanged elsewhere.

**Acceptance Scenarios**:

1. **Given** a replayable test-fix operation and a qualifying surplus alias,
   **when** the fanout includes it as a worker, **then** its output is treated
   as a candidate (unverified until the verifier receipt).
2. **Given** a non-replayable operation, **when** surplus is available, **then**
   only review intents are offered; worker assignment is refused.
3. **Given** a surplus worker candidate, **when** its receipt is recorded,
   **then** attribution follows 001 evidence grades and the surplus ledger
   records worker-mode separately from review-mode.

---

### User Story 4 - Learn fanout policy only through shadow gates (Priority: P2)

As a maintainer, I need fanout decisions (when to fan out, branch count, model
mix) recorded as episodes and improved only via the 001 shadow/backtest/
promotion gates, so early heuristics cannot ossify into active policy.

**Why this priority**: Fanout multiplies inference spend; ungated policy drift
here is the fastest way to burn the economics it is supposed to save.

**Independent Test**: Aggregate fixture fanout episodes; propose a candidate
rule change; assert it stays shadow until backtest, sample-size, regression,
and rollback checks pass.

**Acceptance Scenarios**:

1. **Given** repeated successful 2-branch fanouts on one operation class,
   **when** a profile proposes 3-branch as default, **then** it remains shadow
   until the gates pass.
2. **Given** a gated fanout profile that regresses, **when** rollback runs,
   **then** deterministic single-candidate behavior is restored with the prior
   profile recoverable.

### Edge Cases

- All branches fail identically (systematic environment fault, not model fault).
- The verifier itself is flaky across branches; disagreement becomes `unknown`,
  never a coin flip.
- A branch exceeds its attempt budget mid-run; it is killed and receipted as
  `failed (budget)`.
- Isolation workspace creation fails; fanout degrades to single-candidate flow.
- Two branches produce identical fingerprints; deduplication records one
  winner, one duplicate.
- The primary tree changes during fanout; candidates rebase-check before
  arbitration or are marked stale.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Fanout plans MUST bound branches (default ≤3), models
  (free/cheap fixed aliases only), attempts, wall-clock, and write scope; the
  planner MUST refuse unbounded plans.
- **FR-002**: Execution MUST require declared `isolatedWorkspaces` plus a
  required deterministic verifier; arbitration MUST require a `passed`
  `ExecutionReceipt` to promote any candidate.
- **FR-003**: Destructive command shapes and out-of-scope mutations MUST
  disqualify a branch before execution, independent of verifier output.
- **FR-004**: Surplus aliases MUST serve as workers only on replayable
  operations under verifier arbitration; review-only boundaries elsewhere are
  unchanged.
- **FR-005**: Every branch MUST produce an `ExecutionReceipt`; win, loss,
  disqualification, budget-kill, and stale outcomes MUST all be recorded.
- **FR-006**: Fanout policy changes MUST pass 001 shadow/backtest/promotion
  gates; raw fanout history MUST NOT change active planning.
- **FR-007**: On total fanout failure the outcome MUST be a receipt-backed
  escalation (`escalate-model` or `ask-user`), never a silent best-effort pick.

### Non-Functional Requirements

- **NFR-001**: Planning, safety screening, and arbitration MUST be
  deterministic for identical inputs.
- **NFR-002**: Fanout metadata MUST stay within existing telemetry bounds;
  candidate contents are referenced by fingerprint, never persisted raw.
- **NFR-003**: No test or fixture may require paid inference, live
  credentials, or a live harness runtime; mock workers and verifiers only.
- **NFR-004**: Arbitration overhead MUST be negligible next to candidate
  execution in fixture benchmarks (measured, not assumed).

### Key Entities

- **FanoutPlan**: bounded branches, model aliases, isolation refs, verifier,
  budgets, write scope, safety screen result.
- **CandidateReceipt**: per-branch `ExecutionReceipt` plus branch id, model
  alias, fingerprint, and disqualification reason if any.
- **ArbitrationOutcome**: winner ref + receipt, or escalation with attached
  fanout evidence.
- **FanoutEpisode**: normalized record for shadow policy learning.

## Success Criteria *(mandatory)*

- **SC-001**: Fixture matrices pass for planning bounds, safety refusals,
  arbitration outcomes, and surplus worker/reviewer separation; zero
  regressions.
- **SC-002**: 100% of promoted candidates in fixtures carry a `passed`
  verifier receipt; 100% of unsafe plans are refused with reasons.
- **SC-003**: Total-failure fixtures always end in receipt-backed escalation,
  never silent selection.
- **SC-004**: A candidate fanout policy change cannot reach active planning
  until all 001 promotion gates pass.

## Assumptions

- Spec 002 receipts, capabilities, and isolation contracts are implemented.
- Isolated workspaces are host-provided (worktrees, containers, temp dirs);
  Sabi requests and verifies them, it does not implement sandboxing.
- Free-alias availability and zero-price evidence follow the existing surplus
  resource rules (live-verified zero price only).

## Out of Scope

- General MCTS/RL search or learned proposal distributions.
- Paid-model fanout (free/cheap only until separately gated).
- Automatic primary-task influence from review-mode surplus claims.
- Owning workspaces, containers, or test runners.
