# Feature Specification: Shadow Routing and Operational Telemetry

**Feature Branch**: `010-shadow-routing-telemetry`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Architecture synthesis — build instrumentation now, evaluation
later (`sabi shadow on` in the LiteLLM traffic-mirroring spirit: actual
execution unchanged, proposed routes recorded with full context), plus
Autohand-style operational control-plane telemetry (Prometheus/OTel shape:
latencies, retries, provider state, switches, locks, adapter errors).

## Context: what already exists

- 001 shadow lifecycle for learned candidates (shadow → backtested → gates
  → active/rejected) with backtest/holdout/rollback evidence.
- 009 shadow judgments (semantic observations that must not influence
  routing).
- Decision/telemetry records with allowlist redaction; `sabi report`
  aggregates episodes; no mirroring of live routing decisions; no
  operational metrics export.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mirror live routing without touching it (Priority: P1)

As a future benchmarker, I need `sabi shadow on` to record, per round:
trajectory state, Sabi's actual decision, the candidate set, the actual
model used, Sabi's proposed model, latency, tokens, failure, verification,
recovery, and completion — with actual execution bit-identical whether
shadow is on or off.

**Why this priority**: Thousands of real trajectories later, this corpus is
what makes benchmarking possible. Without it, evaluation starts from zero.

**Independent Test**: Fixture live rounds with shadow on/off; assert actual
routing outputs identical, shadow records complete with candidate sets and
proposed-vs-actual divergence flags.

**Acceptance Scenarios**:

1. **Given** shadow enabled on a fixture trajectory, **when** routing
   completes, **then** actual decisions equal shadow-disabled decisions
   byte-for-byte and the mirror record holds state/decision/candidates/
   actual/proposed/latency/tokens/failure/verification/recovery/completion.
2. **Given** a proposed route diverging from actual, **when** recorded,
   **then** the divergence is flagged with both sides and the reason each
   was (or would be) chosen — no judgment of which was better.
3. **Given** shadow storage bounds reached, **when** recording, **then**
   oldest records compact per retention policy with an export first —
   recording never fails routing.

---

### User Story 2 - Operate Sabi with honest signals (Priority: P2)

As an operator, I need operational telemetry in OTel/Prometheus shape —
router latency, dispatch latency, TTFT, retries, provider state, switches,
locks, adapter errors — so Sabi's own health is observable separately from
routing quality.

**Why this priority**: Control-plane observability is what makes multi-
harness production use debuggable; it also feeds the UDS spike verdict.

**Independent Test**: Fixture operations emit metric series; assert names,
labels, units, and redaction (no prompts, no secrets, hashed identities).

**Acceptance Scenarios**:

1. **Given** a provider outage fixture, **when** observed, **then** retry
   counts, breaker transitions, and fast-fail latencies appear as series
   with route labels.
2. **Given** a switch with required affinity, **when** pinned, **then** lock
   holds and releases appear with reasons.
3. **Given** metric export, **when** serialized, **then** no raw content or
   secrets are present (redaction fixtures).

---

### User Story 3 - Turn mirrors into evaluation when ready (Priority: P3)

As a maintainer, I need the mirror corpus queryable by operation class,
model, harness, divergence, and outcome — so a future benchmark selects
slices without new instrumentation, and proposals backtest against real
history.

**Why this priority**: Deferred by design (evaluation later), but the query
shape must exist early or the corpus rots.

**Independent Test**: Fixture corpus queries by class/model/harness/
divergence return exact slices with sample counts and provenance labels.

**Acceptance Scenarios**:

1. **Given** a corpus with mixed operations, **when** queried for one
   class, **then** only matching records return with counts.
2. **Given** any corpus export, **when** rendered, **then** every record
   carries fixture/live provenance — mirrors never masquerade as
   benchmarks.

### Edge Cases

- Shadow write path slow; async bounded queue, drops recorded as gaps.
- Corpus contains poisoned trajectories (user pasted secrets); sanitizer
  runs at write time with quarantine + reason, not silent storage.
- Operator disables shadow mid-session; already-written records stay,
  new rounds stop cleanly.
- Metric cardinality explosion (per-session labels); bounded label sets
  with aggregation, high-cardinality fields hashed or dropped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `sabi shadow on/off` MUST toggle mirroring with actual
  execution bit-identical either way (asserted in fixtures).
- **FR-002**: Mirror records MUST hold state, decision, candidate set,
  actual/proposed models, latency, tokens, failure, verification,
  recovery, completion, with divergence flags.
- **FR-003**: Storage MUST be bounded with export-first compaction; gaps
  and drops MUST be recorded, never silent.
- **FR-004**: Operational metrics MUST cover router/dispatch latency,
  TTFT, retries, provider state, switches, locks, adapter errors in
  OTel/Prometheus shape with redaction.
- **FR-005**: Corpus queries MUST slice by class/model/harness/divergence
  with counts and provenance labels.
- **FR-006**: Write-time sanitization MUST quarantine secret-bearing
  content with reasons; routing MUST be unaffected.

### Non-Functional Requirements

- **NFR-001**: Mirroring MUST NOT change routing outputs (equivalence
  fixtures) and MUST NOT add more than the 001 overhead budget to the
  routing path (measured).
- **NFR-002**: Metric label cardinality MUST be bounded; high-cardinality
  values hashed or aggregated.
- **NFR-003**: No test may require live traffic, paid inference, or
  credentials; fixture traffic only.
- **NFR-004**: Mirror store MUST live under user scope with 0600 files
  (shared with 006 durable-state conventions when present).

### Key Entities

- **ShadowRecord**: per-round mirror with actual-vs-proposed divergence.
- **RetentionPolicy**: bounds, export-first compaction, gap accounting.
- **MetricSeries**: named operational series with bounded labels.
- **CorpusSlice**: query result with counts + provenance.

## Success Criteria *(mandatory)*

- **SC-001**: Shadow on/off equivalence holds byte-for-byte across
  fixtures with complete mirror records.
- **SC-002**: Bounds/gaps/quarantine fixtures behave explicitly; routing
  never fails on mirror pressure.
- **SC-003**: Metric fixtures assert names/labels/units/redaction;
  outage fixtures show the expected series.
- **SC-004**: Corpus slicing fixtures return exact slices with
  provenance; nothing is presented as a benchmark.

## Assumptions

- 001 shadow gates and 009 shadow judgments are sibling concepts: 009
  observes semantics, this feature mirrors routing — both non-influencing.
- 006 durable store, when present, hosts mirrors; until then a bounded
  local store with the same conventions.
- Benchmarks themselves are a later decision; this feature only makes
  them possible.

## Out of Scope

- Running benchmarks or claiming quality/cost wins (collection only).
- Exporting mirrors to third parties (local corpus only).
- Alerting/paging integrations (series + shape only).
- Real-time dashboards (report/CLI surfaces consume the same data later).
