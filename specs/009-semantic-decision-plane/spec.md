# Feature Specification: Semantic Decision Plane

**Feature Branch**: `009-semantic-decision-plane`

**Created**: 2026-09-23

**Status**: Planned

**Input**: JEVfire/jevify synthesis — JEVfire's "one context, many finite
decisions" (score independent labels over a shared prefix instead of
generating JSON essays; scores are relative preferences, not calibrated
confidence; independent fields cannot condition on each other) and jevify's
systematic hunt for spend-on-generation, text-as-decision, repeated context,
serializable judgments, brittle rules, sampling, and manual review. Sabi
today: TypeSafe Jev asks three typed questions (real_problem, difficulty,
shadow evidence_redundant) behind deterministic gates.

## Context: what already exists

- `packages/core/src/judge.ts`: bounded state-conditioned `JudgeEvidence`
  slots, deterministic gates ahead of the judge, TypeSafe backend with
  validation/retry/timeout/cache/fail-open.
- 001 shadow lifecycle (shadow/backtest/promotion gates) and semantic
  episodes with evidence grades.
- Heuristic `RoundKind` (first-turn/exploration/implementation/
  verification/unclassified) as the deterministic phase layer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Decide once per context, not once per question (Priority: P1)

As the router, I need a DecisionFrame — context fingerprint + generation +
deterministic facts + a set of finite questions (genuineFailure, taskPhase,
difficulty, evidenceSufficient, contextRedundant, safeToSwitch,
needsVerification, retryable, recoveryAction, fanoutUseful, privacyClass) —
evaluated over one shared trajectory state, so N sequential classifier/judge
calls collapse into one frame with ordinary code applying policy.

**Why this priority**: The core JEVfire lesson: deterministic facts first →
one shared semantic frame → policy in code. Fewer round trips, one cache
key, coherent results.

**Independent Test**: Fixture frames with deterministic facts + question
sets run through a fixture backend; assert one context assembly, per-question
typed results, and policy outputs identical to the equivalent sequential
calls.

**Acceptance Scenarios**:

1. **Given** a frame with five independent questions, **when** evaluated,
   **then** context is assembled once (asserted by construction counter)
   and all five results return typed.
2. **Given** deterministic facts that already decide the outcome, **when**
   the frame runs, **then** no semantic backend is consulted (gates stay
   ahead) and the fact-sourced result is marked as such.
3. **Given** the same context fingerprint + generation, **when** re-evaluated,
   **then** cached results return without backend calls (invalidation on
   generation change).

---

### User Story 2 - Keep the semantic engine replaceable (Priority: P1)

As a maintainer, I need a backend interface with three lanes — TypeSafe Jev
(calibrated remote), a local JEVfire-style lane (no egress, existing local
model, finite labels), generic structured-LLM fallback — plus per-question
requirements (confidence need, privacy, allowed backends), so no single
vendor or model is load-bearing.

**Why this priority**: "A router for its own routing cognition" — clean
architecture that survives vendor, price, and privacy changes.

**Independent Test**: Fixture backends per lane + question requirements;
assert routing to the cheapest eligible backend, privacy violations refused
(remote lane never receives local-only questions), and fallback engages on
backend failure with receipts.

**Acceptance Scenarios**:

1. **Given** a `local-ok` question and a healthy local lane, **when**
   evaluated, **then** the local lane serves it with zero egress recorded.
2. **Given** a question requiring calibrated confidence, **when** only the
   local lane is available, **then** it is refused or marked
   relative-only — local scores never masquerade as calibrated.
3. **Given** all backends failing, **when** evaluated, **then** every
   question resolves `unknown` and deterministic policy proceeds (fail-open
   with receipts, never a stall).

---

### User Story 3 - Treat questions as versioned code (Priority: P2)

As a maintainer evolving semantics, I need question definitions as
version-controlled assets (id, version, type, context slots, independence
flag, authority, fallback, egress, consumers, promotion mode + minimum
samples) with backtestable v3-vs-v4 comparisons over historical
trajectories — so changing a question is as rigorous as changing policy.

**Why this priority**: Prevents silent semantic drift; makes the corpus in
010 capable of answering "was v4 better?".

**Independent Test**: Fixture question v3/v4 + historical trajectory
fixtures; assert versioned evaluation, diff reports, and promotion blocked
below minimum samples.

**Acceptance Scenarios**:

1. **Given** question v4 with 100 samples against a 500 minimum, **when**
   promotion is attempted, **then** it stays shadow with the shortfall
   recorded.
2. **Given** dependent questions declared independent, **when** validated,
   **then** the definition is rejected (JEVfire's hardening rule encoded:
   dependents become stages or a joint enum).

---

### User Story 4 - Collect shadow judgments on every round (Priority: P2)

As a future benchmarker, I need shadow semantic fields (difficulty,
redundancy, escalation-warranted, verification-required, fanout-valuable,
contamination + scores) attached to every round without influencing routing —
so 100k rounds later the policy dataset exists instead of starting from zero.

**Why this priority**: Instrumentation now, evaluation later; the dataset is
the moat.

**Independent Test**: Fixture rounds produce shadow fields alongside actual
routing; assert routing outputs identical with shadows on/off and shadows
persist with provenance + backend identity.

**Acceptance Scenarios**:

1. **Given** shadows enabled, **when** routing completes, **then** the
   decision equals the shadows-disabled decision byte-for-byte.
2. **Given** a shadow backend outage, **when** rounds proceed, **then**
   routing is unaffected and the gap is recorded (missing shadows are
   gaps, not zeros).

---

### User Story 5 - Jevify adapters, and know where not to (Priority: P2)

As an adapter author, I need `sabi inspect-adapter` to find semantic
decision points (regex classifiers, sequential LLM calls, JSON-as-decision,
duplicated context, hard thresholds, sampling, manual review) and propose
finite-question replacements with deterministic guards retained — plus
explicit rejects where determinism is superior (protocol codes, entitlement,
receipts).

**Why this priority**: Automates the automation; spreads the plane without
spreading misuse.

**Independent Test**: Fixture adapter sources with planted patterns; assert
findings name each site with existing-pattern → candidate-question mapping,
and planted deterministic-superior sites yield rejects with reasons.

**Acceptance Scenarios**:

1. **Given** 14 regex branches classifying failure semantics, **when**
   inspected, **then** one finite-question candidate is proposed with guards
   retained.
2. **Given** entitlement detection via string matching, **when** inspected,
   **then** the verdict is reject (needs receipt, not judgment) with reason.

### Edge Cases

- Question dependencies form a cycle; definition validation rejects.
- Frame context exceeds backend limits; deterministic subset selection with
  omission marked `unknown`.
- Backend returns out-of-enum labels; invalid → `unknown`, never coerced.
- Privacy class `restricted` with only remote lane healthy; questions wait
  or resolve `unknown`, egress never violates class.
- Cached frame reused across a compaction generation; generation mismatch
  invalidates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST define the DecisionFrame (fingerprint, generation,
  deterministic facts, finite question set) with single context assembly
  and per-question typed results.
- **FR-002**: Deterministic gates MUST precede backend consultation; cached
  frames MUST invalidate on generation change.
- **FR-003**: The backend interface MUST support Jev / local-finite /
  structured-LLM lanes with per-question confidence, privacy, and
  allow-list requirements; privacy violations MUST refuse.
- **FR-004**: Local-lane scores MUST be labeled relative-only; calibrated
  claims require the calibrated lane.
- **FR-005**: Question definitions MUST be versioned assets with
  independence validation, promotion minimums, and v-next backtest support.
- **FR-006**: Shadow questions MUST NOT influence routing (byte-identical
  decisions) and MUST persist with provenance; outages MUST NOT affect
  routing.
- **FR-007**: `sabi inspect-adapter` MUST report candidate mappings and
  explicit rejects with reasons.
- **FR-008**: Total backend failure MUST resolve all questions `unknown`
  with fail-open deterministic continuation.

### Non-Functional Requirements

- **NFR-001**: Frame assembly, caching, and policy application MUST be
  deterministic for identical inputs.
- **NFR-002**: Context payloads MUST respect existing judge bounds and
  redaction; per-question egress policy enforced.
- **NFR-003**: No test may require paid inference, live backends, or
  credentials; fixture backends only.
- **NFR-004**: Frame overhead (assembly + cache) MUST be measured against
  the equivalent sequential calls in fixtures (fewer backend invocations
  expected, reported not claimed).

### Key Entities

- **DecisionFrame**: fingerprint + generation + facts + questions.
- **SemanticBackend**: lane interface with capability/privacy contract.
- **QuestionDef**: versioned question asset with promotion rules.
- **ShadowJudgment**: per-round non-influencing observation with provenance.

## Success Criteria *(mandatory)*

- **SC-001**: Frame fixtures show single assembly + typed results +
  gate precedence + cache invalidation; zero regressions.
- **SC-002**: Backend-routing fixtures prove cheapest-eligible selection,
  privacy refusal, calibration labeling, and fail-open outage behavior.
- **SC-003**: Versioned-question fixtures block under-sampled promotion
  and reject dependency violations.
- **SC-004**: Shadow on/off routing equivalence holds byte-for-byte across
  fixtures.
- **SC-005**: Inspector fixtures map planted patterns and reject
  deterministic-superior sites with reasons.

## Assumptions

- Current Jev (three typed questions + gates) is the first backend and the
  migration reference; heuristic `RoundKind` stays as the deterministic
  phase layer.
- Local-lane implementation (vLLM/JEVfire-style) is an interface + fixture
  lane first; a real local backend is a follow-up, not this feature.
- Generation ≠ decision capacity is a design principle, not a migration
  mandate: existing call sites move incrementally.

## Out of Scope

- Training or fine-tuning semantic classifiers.
- Real local-model backend packaging (interface + fixtures only).
- Replacing deterministic classifiers with semantic ones by default
  (shadow first, promotion through 001 gates).
- Automatic promotion of question versions (minimum samples + backtest
  required).
