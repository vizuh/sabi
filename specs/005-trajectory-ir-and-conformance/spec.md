# Feature Specification: Trajectory IR + Adapter SDK and Conformance

**Feature Branch**: `005-trajectory-ir-and-conformance`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Architecture synthesis — Sabi's largest gap is not the routing
algorithm but the missing normalized contract between every harness/runtime
and the Sabi brain. Competitor survey: vLLM SAAR (session state, switch
locks), Autohand (capability matching, conformance gates), BitRouter (protocol
breadth, publishable policy), LiteLLM (reliability substrate). Sabi's
`maintainers.md` adapter contract already points here; this turns the
documentation contract into an executable protocol + conformance suite.

## Context: what already exists

- `TrajectoryState`, `TrajectoryEvidence`, `VerificationState`,
  `ExecutionReceipt` (002), `ExecutionCapabilities` (002), `RecoveryPlan`,
  cache decisions, controller handoffs, borrowed auth — the vocabulary exists
  but its meaning still partly depends on the adapter ("turn", "failure",
  "tool loop", "session", "completion" vary by host).
- `docs/maintainers.md` defines the adapter boundary (detect, identify
  session, receive, dispatch, observe typed outcomes, uninstall cleanly, no
  policy duplication) as prose. No machine-readable manifest or shared
  conformance suite exists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Route from one canonical trajectory (Priority: P1)

As the Sabi scheduler, I need every harness event normalized into one
Trajectory IR — session, turn, phase, capabilities, tool state, continuity
state, provider state, context/cache, execution evidence, verification
receipts, budget/constraints, outcome — so policy never branches on
host-specific fields.

**Why this priority**: This is the bug surface that grows with every adapter.
One IR kills the adapter × policy combinatorics.

**Independent Test**: Translate fixture event streams from three harness
shapes (mod-style continuing turns, proxy-style request/response, controller
dispatch/observe) into IR; assert identical policy inputs for equivalent
trajectories and explicit `unknown` where a host cannot provide a field.

**Acceptance Scenarios**:

1. **Given** equivalent failure trajectories from two harness shapes, **when**
   normalized, **then** the scheduler receives byte-equivalent IR policy
   inputs.
2. **Given** a host that cannot report turn identity, **when** translated,
   **then** the IR marks turn `unknown` and downstream logic degrades
   explicitly (no inferred identity).
3. **Given** existing `TrajectoryState` consumers, **when** the IR lands,
   **then** they keep working: the IR wraps/extends current types, migration
   is additive with a compatibility shim, never a flag-day rewrite.

---

### User Story 2 - Emit one Decision envelope (Priority: P1)

As a harness receiving Sabi's answer, I need a single Decision envelope —
action, model, provider, harness, effort, lock/affinity, deadline, fallback
policy, reason — so hosts implement one contract instead of N bespoke
decision shapes.

**Why this priority**: Symmetric with US1; the IR is the way in, the Decision
is the way out.

**Independent Test**: Render decisions for inference, execution, and
controller actions; assert each host translator consumes the same envelope
and unknown-to-host fields are refused with reasons, never silently dropped.

**Acceptance Scenarios**:

1. **Given** a decision naming an effort level the host cannot express,
   **when** translated, **then** the host refuses that field explicitly and
   applies the remainder, recording the refusal.
2. **Given** a fallback policy in the envelope, **when** the primary route
   fails, **then** the host follows the stated fallback order without
   re-asking Sabi for what was already decided.

---

### User Story 3 - Declare adapters in machine-readable manifests (Priority: P2)

As a maintainer adding the 15th adapter, I need each adapter to ship a
manifest (`adapterProtocol` version, id, host versions, surfaces, capability
claims) so Sabi can refuse mismatched hosts instead of misbehaving.

**Why this priority**: Declarations replace tribal knowledge; version skew
becomes a legible error.

**Independent Test**: Load valid, stale-protocol, and over-claiming fixture
manifests; assert accept / refuse-with-reason / capability-downgrade
outcomes respectively.

**Acceptance Scenarios**:

1. **Given** a manifest claiming `modelSwitch: true` on a host build that
   removed the seam, **when** verified, **then** conformance fails the claim
   and the adapter runs in degraded mode with the downgrade recorded.
2. **Given** `adapterProtocol` older than Sabi's minimum, **when** loaded,
   **then** the adapter is refused with an upgrade hint, never partially run.

---

### User Story 4 - Verify every adapter against one conformance suite (Priority: P2)

As a maintainer, I need `sabi adapter verify <id>` to run the same suite for
every adapter — detection, non-destructive install/uninstall, session/turn
identity stability, cancellation, streaming/tool/parallel/structured-output/
reasoning/files/images preservation, timeout + cancellation propagation, auth
ownership, secrets hygiene, typed failure/completion receipts, defined
Sabi-unavailable behavior, refusal (not silent degradation) on unsupported
capability — so hardening is measured, not hoped for.

**Why this priority**: Per the synthesis, this eliminates more bugs than
thousands of lines of router logic.

**Independent Test**: Run the suite against fixture adapters (conformant,
lossy-streaming, identity-unstable, secret-leaking); assert pass/fail per
check with reasons, and overall verdicts of pass / pass-with-downgrades /
fail.

**Acceptance Scenarios**:

1. **Given** an adapter that drops reasoning fields, **when** verified,
   **then** the preservation check fails with the field named.
2. **Given** Sabi unavailable during verification, **when** the adapter runs,
   **then** its defined fallback behavior is asserted (fail-open documented,
   never hang).
3. **Given** an unsupported capability request, **when** verified, **then**
   refusal is asserted; silent degradation fails the suite.

### Edge Cases

- Two adapters for the same host disagree on turn identity; IR marks the
  conflict, policy treats identity as `unknown`.
- A host upgrades mid-session and gains a capability; the manifest is
  re-read at phase boundaries, in-flight decisions keep the old snapshot.
- Conformance run against a live host mutates user config; the suite runs in
  an isolated profile/home and refuses non-empty targets.
- Decision envelope version skew between Sabi core and an old adapter;
  translator negotiates down or refuses with reason.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST define the Trajectory IR covering session, turn,
  phase, capabilities, tool state, continuity state, provider state,
  context/cache, execution evidence, verification receipts,
  budget/constraints, and outcome — with explicit `unknown`, never inference.
- **FR-002**: Sabi MUST define the Decision envelope (action, model,
  provider, harness, effort, lock/affinity, deadline, fallback policy,
  reason); host translators MUST refuse untranslatable fields with reasons.
- **FR-003**: Adapters MUST ship versioned machine-readable manifests;
  protocol mismatch MUST refuse, capability over-claims MUST downgrade with
  records.
- **FR-004**: `sabi adapter verify <id>` MUST run the shared conformance
  suite (identity, preservation, propagation, auth/secrets, receipts,
  unavailable-behavior, refusal) with per-check verdicts.
- **FR-005**: Migration MUST be additive: current `TrajectoryState` consumers
  work through a compatibility shim; no flag-day rewrite.
- **FR-006**: IR translation MUST NOT persist raw prompts, tool arguments,
  or secrets; fingerprints and allowlisted codes only.

### Non-Functional Requirements

- **NFR-001**: Translation and decision rendering MUST be deterministic for
  identical inputs.
- **NFR-002**: IR payloads MUST respect existing telemetry bounds; no
  unbounded transcript retention.
- **NFR-003**: Conformance MUST run against fixture doubles by default; live
  runs require isolated profiles and explicit opt-in.
- **NFR-004**: Translation overhead MUST stay within the 001 NFR-003 routing
  budget (measured, not assumed).

### Key Entities

- **TrajectoryIR**: canonical normalized trajectory (see FR-001).
- **DecisionEnvelope**: canonical scheduler output (see FR-002).
- **AdapterManifest**: versioned capability/surface declaration.
- **ConformanceReport**: per-check verdicts + overall pass/downgrade/fail.

## Success Criteria *(mandatory)*

- **SC-001**: Fixture streams from three harness shapes normalize to
  equivalent IR; unknown-marking fixtures pass; zero regressions.
- **SC-002**: Decision rendering fixtures refuse untranslatable fields with
  reasons; fallback policies execute in order.
- **SC-003**: Manifest fixtures (valid/stale/over-claiming) produce
  accept/refuse/downgrade correctly.
- **SC-004**: The conformance suite distinguishes fixture adapters
  (conformant/lossy/unstable/leaking) with named reasons per failure.

## Assumptions

- Spec 002 receipts/capabilities are the evidence base the IR normalizes.
- Hosts cooperate through supported seams; Sabi never scrapes private host
  state to fill IR fields.
- `maintainers.md` remains the prose contract; manifests + suite are its
  executable form.

## Out of Scope

- Rewriting existing adapters onto the IR in this feature (migration adapters
  are per-host follow-ups; the shim keeps them working).
- New harness integrations (bridges are spec 007).
- Benchmarking policy quality (spec 010 collects the corpus first).
