# Feature Specification: Native Protocols, Capability Evidence, Route Objectives

**Feature Branch**: `008-protocols-objectives-evidence`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Architecture synthesis — native Gemini `generateContent`
(BitRouter parity across OpenAI Chat/Responses, Anthropic Messages, Gemini),
`WireProtocol` with native-body preservation (borrowed-auth pattern),
capability discovery beyond static operator declaration (declared →
discovered → probed → observed → verified → expired), and route objectives
(Autohand/Not Diamond: cost/latency/quality tradeoffs as routing input with
tiers kept as the mechanism).

## Context: what already exists

- Native wire coverage: OpenAI Chat Completions, OpenAI Responses, Anthropic
  Messages, plus the borrowed-auth path. No Gemini.
- `ModelCapabilities` (tools, parallel/strict, modalities, structured
  output, reasoning efforts, supported parameters) is operator-declared;
  omission means unknown. No source/confidence/TTL layering.
- Tiers (cheap/mid/strong) are the selection mechanism; no user-facing
  objective (fastest/cheapest/local-only/privacy) maps onto them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Route Gemini natively (Priority: P1)

As Sabi serving Gemini-backed harnesses, I need native `generateContent`
support — streaming and tool-call preservation verified against fixtures —
so Gemini joins the first-class protocol set instead of a lossy translation.

**Why this priority**: Closes the obvious native-protocol hole; unblocks
Gemini CLI-class hosts.

**Independent Test**: Fixture generateContent round trips (streaming,
function calls, parallel calls, structured output where supported); assert
preservation per the 005 conformance preservation checks.

**Acceptance Scenarios**:

1. **Given** a Gemini tool-call round trip, **when** proxied, **then** call
   ids, ordering, and arguments survive byte-equivalent.
2. **Given** a Gemini-only capability (e.g. thinking controls), **when**
   Sabi does not understand it, **then** it passes through untouched with
   the unknown-capability recorded — never stripped or rewritten.

---

### User Story 2 - Preserve native bodies, mutate minimally (Priority: P1)

As a maintainer debugging provider differences, I need the wire layer typed
as `openai-chat | openai-responses | anthropic-messages |
gemini-generate-content` with native bodies preserved and only the smallest
surface mutated — so provider quirks stop hiding inside a lossy canonical
form.

**Why this priority**: The borrowed-auth lesson generalized: normalization
is where subtle bugs breed.

**Independent Test**: Fixture bodies per protocol round-trip through the
proxy; assert diff-scoped mutations only (model id, routing headers,
capability-safe transforms) with everything else byte-identical.

**Acceptance Scenarios**:

1. **Given** an Anthropic request with provider-specific fields, **when**
   routed, **then** unknown-to-Sabi fields pass through untouched.
2. **Given** a mutation Sabi must make, **when** applied, **then** the
   receipt records exactly what changed (field-level, no raw values).

---

### User Story 3 - Know what a model can actually do, with receipts (Priority: P2)

As the router filtering candidates, I need `CapabilityEvidence<T>` —
value + source (config / provider-catalog / host-catalog / protocol-probe /
runtime-receipt) + observedAt/expiresAt + confidence (declared / observed /
verified) — so "model exists ≠ usable ≠ tools work ≠ parallel works ≠
structured output works ≠ this harness preserves it" is encoded, with TTL
expiry instead of permanent belief.

**Why this priority**: Turns the philosophical understanding into the type
system; kills stale-capability bugs.

**Independent Test**: Fixture evidence chains promote declared → observed →
verified on runtime receipts and expire on TTL; assert routing uses the
highest non-expired confidence and records which level decided.

**Acceptance Scenarios**:

1. **Given** parallel-tools declared but a runtime receipt showing serial
   execution, **when** filtered, **then** confidence drops to observed-false
   and parallel-requiring routes exclude the model with reason.
2. **Given** expired evidence and no fresh signal, **when** filtered, **then**
   the capability reads `unknown` (re-probe or exclude, never assume).
3. **Given** a harness that strips structured output, **when** evidenced,
   **then** the limitation attaches to the harness leg, not the model —
   the model stays eligible elsewhere.

---

### User Story 4 - Route by objective, select by tier (Priority: P2)

As a user, I need route objectives — optimize balanced/cost/latency/quality,
max cost/latency caps, local-only, free-only, subscription-only, privacy
levels, minimum evidence level — compiled to constraints over eligible
routes, with tiers unchanged as the selection mechanism.

**Why this priority**: Makes Sabi a policy engine instead of a tier
selector, without disturbing the proven tier machinery.

**Independent Test**: Fixture catalogs + objectives assert eligible-route
sets (caps exclude, privacy excludes, evidence-level excludes) and
deterministic tier pick within eligibility.

**Acceptance Scenarios**:

1. **Given** `freeOnly: true`, **when** routing, **then** only live-verified
   zero-price routes are eligible (surplus resource rules reused).
2. **Given** `maxCostUsd` below every eligible route's known cost and one
   route with unknown cost, **when** routing, **then** the unknown-cost
   route is excluded (unknown is not free) with reason recorded.
3. **Given** `privacy: local`, **when** routing, **then** only local
   execution paths are eligible; remote candidates are excluded with
   reasons, never attempted.

### Edge Cases

- Gemini API version drift; installed-shape verification with cited
  reference, fixtures regenerated on drift with a dated note.
- Conflicting evidence (probe says works, receipt says fails); receipts
  outrank probes, probes outrank catalogs, catalogs outrank config.
- Objective unsatisfiable; refuse with the binding constraint named (ask,
  don't silently relax).
- TTL expiry mid-trajectory; in-flight route keeps its snapshot, next round
  re-evaluates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST support native Gemini `generateContent`
  (streaming, tools, parallel, structured output where the protocol
  allows) with preservation fixtures.
- **FR-002**: The wire layer MUST be typed per protocol with native-body
  preservation; mutations MUST be diff-scoped and receipted field-level.
- **FR-003**: Capabilities MUST carry source/confidence/TTL evidence;
  routing MUST use the highest non-expired level and record it.
- **FR-004**: Evidence precedence MUST be runtime-receipt > protocol-probe
  > host/provider-catalog > config; conflicts MUST resolve by precedence
  with records.
- **FR-005**: Route objectives MUST compile to eligibility constraints over
  routes; tiers MUST remain the selection mechanism; unknown cost/price
  MUST exclude (never assume free).
- **FR-006**: Unsatisfiable objectives MUST refuse with the binding
  constraint named; silent relaxation is forbidden.
- **FR-007**: Harness-leg limitations MUST attach to the harness, never
  penalize the model globally.

### Non-Functional Requirements

- **NFR-001**: Wire handling and eligibility MUST be deterministic for
  identical inputs.
- **NFR-002**: Evidence records MUST respect telemetry bounds; no raw
  bodies in receipts/logs.
- **NFR-003**: No test may require live providers, paid inference, or
  credentials; fixture protocol shapes only (regenerated on verified drift).
- **NFR-004**: Eligibility evaluation MUST stay within the 001 routing
  overhead budget (measured).

### Key Entities

- **WireProtocol**: four-way protocol tag with native body handlers.
- **CapabilityEvidence\<T\>**: value + source + timestamps + confidence.
- **RouteObjective**: optimize/caps/locality/privacy/evidence constraints.
- **EligibilityVerdict**: eligible routes + excluded routes with reasons.

## Success Criteria *(mandatory)*

- **SC-001**: Gemini preservation fixtures pass; passthrough fixtures prove
  unknown fields survive.
- **SC-002**: Mutation receipts name exact fields; no silent rewrites in
  fixtures.
- **SC-003**: Evidence promotion/expiry/conflict fixtures resolve per
  precedence with recorded levels.
- **SC-004**: Objective fixtures produce exact eligible sets; unsatisfiable
  objectives refuse with named constraints.

## Assumptions

- Protocol shapes verified against live references at build time (cite
  repo/commit/date); drift regenerates fixtures with notes.
- Specs 002 (receipts), 005 (IR/conformance), 006 (health ledgers) are the
  integration surfaces.
- Free-price evidence reuses surplus resource rules unchanged.

## Out of Scope

- Bedrock Converse / Vertex variants (follow-up protocols, same pattern).
- Websocket/realtime transports.
- Changing tier semantics or adding tiers (objectives map onto tiers).
- Live provider capability probing (fixtures + receipts first).
