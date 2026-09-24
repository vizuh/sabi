# Feature Specification: ACP and A2A Bridges

**Feature Branch**: `007-acp-a2a-bridges`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Architecture synthesis — ACP as the common coding-agent/editor
interface (session lifecycle, capabilities, resume, prompt, cancellation,
permissions, updates over JSON-RPC; ecosystem: Claude, Codex, OpenCode,
Gemini CLI, Copilot; clients: Zed, VS Code, JetBrains, Neovim) and A2A 1.0
as the independent-agent standard (discovery, lifecycle, streaming,
artifacts, async collaboration). Preserves Sabi's inference-vs-controller
distinction: bridges are session/task surfaces, never implicit inference
access.

## Context: what already exists

- Controller hooks for Claude Code/Codex/OpenCode/Orca (task/session
  surface, fail-open); proxy/mod inference routing per round.
- `RecoveryCapsule` + handoff path for cross-session continuity.
- Adapter evidence reported in layers (source/tests → live execution).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Speak ACP to editors and agents (Priority: P1)

As Sabi's controller, I need an ACP bridge speaking session lifecycle,
capability negotiation, resume, prompt, cancellation, permissions, and
progress updates — so Zed, VS Code, JetBrains, and Neovim reach Sabi through
one protocol instead of four custom integrations.

**Why this priority**: One bridge replaces N editor customs; ecosystem
momentum (Claude/Codex/OpenCode/Gemini CLI/Copilot) makes it the highest
leverage integration surface.

**Independent Test**: Fixture ACP client/server pairs exercise
initialize→session→prompt→stream→cancel→resume→permissions; assert
capability negotiation bounds behavior and cancellation propagates to
dispatch with receipts.

**Acceptance Scenarios**:

1. **Given** an editor client declaring a capability subset, **when** Sabi
   bridges a session, **then** only negotiated capabilities are used and
   gaps degrade explicitly.
2. **Given** a mid-stream cancellation, **when** received, **then** dispatch
   cancels, partial work is receipted, and resume continues from the
   receipted point — never replays blindly.
3. **Given** a permission request, **when** unanswered, **then** the default
   is deny-with-receipt, never allow-by-timeout.

---

### User Story 2 - Never claim inference access ACP does not grant (Priority: P1)

As a user reading Sabi's capability claims, I need the ACP bridge scoped to
session lifecycle, permissions, progress, cancellation, controller handoff,
and capability evidence — with per-round model routing still requiring a
native provider/proxy/mod seam — so no false capability is ever advertised.

**Why this priority**: The distinction that prevents the project's most
dangerous misrepresentation.

**Independent Test**: Fixture matrix asserting inference-routing attempts
through ACP-only hosts are refused with reasons directing to the correct
surface (proxy/mod/bundle).

**Acceptance Scenarios**:

1. **Given** an ACP-only host, **when** per-round model routing is
   requested, **then** Sabi refuses with the native-seam requirement stated,
   and controller/session features keep working.
2. **Given** docs or status output, **when** ACP capabilities render, **then**
   inference routing is never listed for ACP-only hosts (conformance-style
   assertion on claims).

---

### User Story 3 - Delegate to independent agents over A2A (Priority: P2)

As the controller, I need A2A discovery, task lifecycle, streaming,
artifacts, and async collaboration — so `switch-harness`/`SPAWN` grows into
"send to the right independent agent" with receipts, while inference,
session, and agent routing stay distinct concepts (model vs session vs
agent).

**Why this priority**: Completes the routing ladder (model → provider →
effort → harness → session → agent) without conflating layers.

**Independent Test**: Fixture A2A agents with capability cards; assert
discovery filters by declared capability, delegation carries capsules,
artifacts return typed, and async completion reconciles with receipts.

**Acceptance Scenarios**:

1. **Given** two fixture agents with different capability cards, **when** a
   task needs a declared capability, **then** discovery selects the
   matching agent and records the card evidence (declaration, not proof).
2. **Given** an async delegated task, **when** completion arrives late,
   **then** it reconciles idempotently with the originating session (006
   durable-state semantics).
3. **Given** an agent advertising inference control it cannot prove, **when**
   evaluated, **then** the claim is treated as unverified and never as a
   routing entitlement.

### Edge Cases

- ACP host disconnects mid-session; resume state is receipted, work is not
  assumed complete.
- A2A capability card changes between discovery and delegation; re-validate
  at dispatch or refuse.
- Editor sends permissions outside the negotiated set; deny + record.
- Duplicate A2A completion delivery; idempotent reconcile by task id.
- ACP and native-mod surfaces on the same host disagree; each surface
  reports its own evidence, never merged silently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The ACP bridge MUST implement session lifecycle, capability
  negotiation, resume, prompt, streaming progress, cancellation, and
  permissions over the ACP wire shape with fixture-verified round trips.
- **FR-002**: Cancellation MUST propagate to dispatch with partial-work
  receipts; resume MUST continue from receipted points.
- **FR-003**: Permission defaults MUST be deny-with-receipt on ambiguity or
  timeout.
- **FR-004**: ACP-only hosts MUST be refused per-round inference routing
  with the native-seam requirement stated; capability claims MUST be
  assertion-tested so inference is never listed for them.
- **FR-005**: The A2A bridge MUST implement discovery-by-card, capsule
  carrying delegation, typed artifacts, streaming, and idempotent async
  reconcile.
- **FR-006**: Agent capability cards MUST be treated as declarations with
  provenance, never entitlements or quality proof.
- **FR-007**: Both bridges MUST emit 002 receipts and 005 IR events; no
  bridge-specific evidence shapes.

### Non-Functional Requirements

- **NFR-001**: Protocol handling MUST be deterministic for identical frame
  sequences.
- **NFR-002**: No test may require a live editor, live agent, network
  peer, paid inference, or credentials; fixture peers only.
- **NFR-003**: Wire payloads MUST respect telemetry redaction; no raw
  prompts, file contents, or secrets in receipts/logs.
- **NFR-004**: Bridges MUST fail open to the host's native behavior when
  Sabi is unavailable.

### Key Entities

- **AcpSession**: negotiated capabilities, resume cursor, permission ledger.
- **A2ADelegation**: task id, capability card evidence, capsule, artifacts,
  reconcile state.
- **BridgeClaimSet**: assertion-tested capability claims per host surface.

## Success Criteria *(mandatory)*

- **SC-001**: Fixture ACP round trips pass for lifecycle, negotiate, resume,
  cancel, permissions; zero regressions.
- **SC-002**: Inference-through-ACP attempts refuse with directing reasons
  in 100% of fixtures; claim assertions hold.
- **SC-003**: A2A discovery/delegation/artifact/reconcile fixtures pass
  with idempotent late completion.
- **SC-004**: Both bridges emit joinable 002 receipts in the shared report.

## Assumptions

- ACP/A2A wire details verified against live specs at implementation time
  (cite exact repo/commit/date; installed contract wins on drift).
- Specs 002 (receipts), 005 (IR/Decision), 006 (durable reconcile) are the
  integration surfaces.
- Editor/client adoption is external; Sabi ships the bridge, not the editor.

## Out of Scope

- Per-round inference inside ACP-only hosts (native seams only).
- Implementing an ACP client inside editors (Sabi is the agent side).
- A2A-based model routing (agents receive tasks, not inference control).
- Live editor/agent certifications (evidence layers reported honestly).
