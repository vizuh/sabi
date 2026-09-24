# Feature Specification: Repo Context Providers and Measurement

**Feature Branch**: `004-repo-context-and-measurement`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Simplicio-material synthesis (persistent repo intelligence, receipts
in report, honest metrics, daemon IPC) mapped against 001 shadow reporting,
`docs/estimates.md` (allocation-vs-tokens discipline), and spec 002
(receipts + capabilities).

## Context: what already exists

- 001 reports aggregate semantic episodes by operation/model/harness with
  evidence grades, shadow-only.
- `docs/estimates.md` documents the worked cost example with explicit
  non-claims (no cache/retries/judge overhead in the headline; recheck rates).
- The controller daemon serves authenticated loopback HTTP on `127.0.0.1:7433`
  (`packages/controller/src/daemon.ts`); hooks pay HTTP IPC per decision.
- No repo indexer exists in Sabi; context is rediscovered per round.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consume repo intelligence without owning it (Priority: P1)

As Sabi routing, I need a repo-state/context provider interface (map,
fingerprints, changed files, incremental deltas) fed by the harness, an MCP
server, or a Simplicio-class runtime — so repeated rounds stop paying to
rediscover the repository, and Sabi never becomes another indexer.

**Why this priority**: Context rediscovery is a per-round tax on every
trajectory; a provider interface removes it without expanding Sabi's job.

**Independent Test**: Fixture providers serve map/fingerprint/delta payloads;
assert the router reuses cached repo state across rounds, invalidates on
fingerprint change, and treats missing providers as `unknown` (full
rediscovery, no failure).

**Acceptance Scenarios**:

1. **Given** a provider map with a matching repo fingerprint, **when** a new
   round plans, **then** no rediscovery evidence is requested and the reuse is
   recorded.
2. **Given** a fingerprint change mid-trajectory, **when** the next round
   plans, **then** the cached map is invalidated explicitly and fresh context
   is gathered once.
3. **Given** no provider, **when** routing runs, **then** behavior is identical
   to today (per-round discovery) with no new failure mode.

---

### User Story 2 - Answer "why did Sabi escalate?" from evidence (Priority: P1)

As a user questioning a routing decision, I need `sabi report` to show the
receipt chain behind escalations, fanout outcomes, and verifications — so
trust comes from inspectable evidence, not log archaeology.

**Why this priority**: Receipts nobody can read are write-only compliance;
visible receipts close the decision → execution → receipt → decision loop.

**Independent Test**: Fixture episodes with escalations, fanout wins/losses,
and verifications render in report output; assert each decision links its
receipts and every claim carries its evidence grade.

**Acceptance Scenarios**:

1. **Given** an escalation, **when** the report renders it, **then** it shows
   the triggering evidence, the action considered, attached receipts, and the
   grade — no bare "escalated" line.
2. **Given** a fanout win, **when** the report renders it, **then** it shows
   branches, winner receipt, loser receipts, and verifier identity.
3. **Given** a model claim without receipt, **when** the report renders it,
   **then** the claim is visibly marked unverified per 001 monotonic rules.

---

### User Story 3 - Measure completed tasks, not functions (Priority: P1)

As a maintainer making roadmap claims, I need a metric catalog measured per
completed task — success, cost, time, calls avoided, strong-calls avoided,
verification/fanout success rates, context tokens, cache retention, router and
executor latencies, escalation precision, recovery success — so no local
micro-benchmark ever becomes a product-level speed claim.

**Why this priority**: This is the messaging immune system: honest metrics
prevent "99% faster" embarrassment and make real wins defensible.

**Independent Test**: Fixture corpora produce the catalog with labelled
provenance (fixture vs live); assert no aggregate is emitted without its
evidence label and sample bounds.

**Acceptance Scenarios**:

1. **Given** a repo-map speedup fixture, **when** the catalog renders
   end-to-end task time, **then** the LLM-dominated total is shown alongside
   the local saving — no isolated-function percentage presented as a turn
   improvement.
2. **Given** missing price or usage data, **when** cost metrics render, **then**
   they show `unknown`, never zero or an invented default.
3. **Given** a fixture-only run, **when** any metric is exported, **then** it
   carries the fixture label and sample count.

---

### User Story 4 - Investigate faster IPC only if profiling justifies it (Priority: P3)

As a maintainer, I need a time-boxed Unix-domain-socket transport spike for
the controller daemon, gated on measured proof that Sabi IPC materially
contributes to task latency — so we never pay transport complexity for
irrelevant millisecond savings.

**Why this priority**: Explicitly the lowest priority: inference rounds cost
hundreds-to-thousands of ms; 1–5 ms of IPC is noise until proven otherwise.

**Independent Test**: Profile hook→daemon→decision latency on fixtures;
assert the spike proceeds to implementation only if Sabi IPC exceeds an
explicit threshold share of round latency, else it closes as "not justified"
with numbers.

**Acceptance Scenarios**:

1. **Given** measured IPC share below threshold, **when** the spike concludes,
   **then** the outcome is a recorded decision with numbers, and HTTP loopback
   remains the only transport.
2. **Given** measured IPC share above threshold, **when** implementation is
   approved, **then** UDS is Unix-only, opt-in, with HTTP fallback and
   identical auth semantics.

### Edge Cases

- Provider map disagrees with tool-observed files; tools win, mismatch flagged.
- A provider serves a stale fingerprint; invalidation is explicit, not silent.
- Report rendering with zero episodes shows empty states, not zeros-as-data.
- Metric export to external systems strips identifiers per telemetry rules.
- UDS socket path collisions across concurrent daemons; namespaced paths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST define a repo-context provider interface (map,
  fingerprints, changed files, incremental deltas) with `unknown` when
  absent; providers MUST be consumed, never implemented as Sabi-owned
  indexers in this feature.
- **FR-002**: Cached repo state MUST invalidate on fingerprint change with an
  explicit record; stale maps MUST NOT silently serve new rounds.
- **FR-003**: Report surfaces MUST link every escalation, fanout outcome, and
  verification to its receipts and evidence grades.
- **FR-004**: The metric catalog MUST be per-completed-task with the defined
  dimensions; every value MUST carry provenance (fixture/live), sample
  bounds, and unknowns where data is absent.
- **FR-005**: No local micro-benchmark figure MUST be presentable as a
  task-level improvement; report composition MUST show end-to-end context.
- **FR-006**: The UDS spike MUST be time-boxed and threshold-gated; transport
  changes ship only on measured justification with HTTP fallback preserved.

### Non-Functional Requirements

- **NFR-001**: Provider caching and invalidation MUST be deterministic for
  identical event sequences.
- **NFR-002**: Report additions MUST respect existing telemetry redaction and
  bounds; no raw prompts, diffs, or secrets.
- **NFR-003**: No test or fixture may require paid inference, live
  credentials, or a live provider/harness.
- **NFR-004**: Spike work MUST NOT alter the active transport; HTTP loopback
  behavior is byte-identical unless the gated implementation lands.

### Key Entities

- **RepoContextProvider**: map/fingerprint/delta source with freshness rules.
- **ReceiptChainView**: decision → receipts → outcome rendering unit.
- **TaskMetricCatalog**: per-completed-task dimensions with provenance labels.
- **TransportSpikeReport**: measured IPC share, threshold verdict, numbers.

## Success Criteria *(mandatory)*

- **SC-001**: Provider fixtures pass for reuse, invalidation, and
  absent-provider parity; zero regressions.
- **SC-002**: Every escalation/fanout/verification in fixture reports links
  receipts with grades; unverified claims visibly marked.
- **SC-003**: The catalog renders fully-labelled metrics on fixtures; no
  unlabelled or zero-filled cost figures.
- **SC-004**: The spike concludes with a numbers-backed verdict either way.

## Assumptions

- Spec 002 receipts/capabilities are the data base.
- Providers may be harness-native, MCP-served, or external runtimes; Sabi
  defines the interface, others implement it.
- Current daemon HTTP semantics (loopback-only, auth) remain authoritative.

## Out of Scope

- Building a Sabi-owned repo indexer or persistent code graph.
- Live cost/quality benchmarks or universal savings claims.
- UDS implementation without a gated spike verdict.
- Exporting metrics to third-party analytics.
