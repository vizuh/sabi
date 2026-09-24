# Feature Specification: Hugging Face Presence

**Feature Branch**: `011-huggingface-presence`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Ecosystem synthesis — Hugging Face fits Sabi as an AI
developer-tool/routing demo on Spaces (Gradio/static/Docker), with later
trajectory + eval datasets, an optional learned component, and a Collection;
GitHub stays canonical for source, npm for distribution. Never present Sabi
as a "model". The Space forces a clean public decision/trajectory API that
dashboard, VS Code, CLI viz, benchmarks, and third-party adapters reuse —
promotion that pays for itself architecturally.

## Context: what already exists

- `sabi report` aggregates episodes; decision/telemetry records are typed
  but have no stable public JSON API.
- Semantic episodes + evidence grades + shadow records are the natural
  dataset rows (sanitized by construction).
- No Hugging Face org, Space, dataset, or Collection exists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish one public decision/trajectory API (Priority: P1)

As any Sabi surface (Space, dashboard, CLI viz, benchmark, third-party
adapter), I need a stable versioned JSON API for trajectory + decision +
receipt data — so the Space is the first consumer of a representation
everything else reuses.

**Why this priority**: The forcing function: without it the Space becomes a
throwaway demo instead of architectural progress.

**Independent Test**: Fixture trajectories serialize through the public API;
assert schema version, backward-compatible field addition only, and zero
raw prompts/secrets/tool-arguments in output (fuzz with adversarial
fixtures).

**Acceptance Scenarios**:

1. **Given** a trajectory with decisions, receipts, and grades, **when**
   serialized, **then** the output validates against the published schema
   version and redaction tests pass.
2. **Given** a v2 consumer reading v1 output, **when** parsed, **then**
   forward compatibility holds for additive fields (asserted in fixtures).
3. **Given** adversarial content (pasted secrets, absolute paths),
   **when** serialized, **then** sanitization strips/quarantines with the
   record marked, never stored raw.

---

### User Story 2 - Demo "one trajectory, many decisions" live (Priority: P1)

As a visitor, I need a Space (e.g. `vizuh/sabi-router`) showing a
simulated/recorded trajectory — read → edit → test → fail → recover →
verify — with per-round model/effort/provider/harness, reason, cache/
continuity state, triggering evidence, unsafe-switches-prevented, receipts,
and cost comparison — linking to GitHub/npm for installation.

**Why this priority**: The killer demo communicates routing value without
requiring installation; it speaks directly to the HF inference-efficiency
audience.

**Independent Test**: Scripted trajectory fixture drives the Space app
locally (container build + run); assert every displayed figure traces to a
record (no invented numbers) and install links resolve.

**Acceptance Scenarios**:

1. **Given** the scripted failing-test round, **when** displayed, **then**
   the shown evidence, receipts, and escalation reason match the fixture
   record exactly.
2. **Given** the cost comparison panel, **when** rendered, **then** it uses
   the estimates-discipline format (allocation change, labeled rates,
   non-claims stated) — never a bare savings percentage.
3. **Given** no backend, **when** the Space loads, **then** the recorded
   trajectory plays fully offline (live inference is a later option, not
   a requirement).

---

### User Story 3 - Publish sanitized trajectory + eval datasets (Priority: P2)

As a researcher, I need versioned datasets (routing/evidence episodes:
operation class, trajectory state, route, model/harness, verification,
recovery, latency/tokens/cost, outcome; plus eval slices) with a documented
sanitizer and privacy gates — so Sabi's evidence compounds publicly.

**Why this priority**: Datasets turn private routing history into community
capital and future benchmark fuel (with 010's corpus as the source).

**Independent Test**: Fixture episodes pass through the dataset sanitizer;
assert schema conformance, secret/path absence (adversarial fixtures), and
reproducible versioned builds (same input → same dataset hash).

**Acceptance Scenarios**:

1. **Given** episodes with pasted secrets, **when** built, **then** the
   build quarantines affected rows with counts reported, never publishes
   them.
2. **Given** a dataset version, **when** rebuilt from the same corpus
   snapshot, **then** the content hash matches (reproducibility asserted).
3. **Given** the dataset card, **when** read, **then** it states collection
   method, labels, limits, and non-claims (no universal quality
   implications).

---

### User Story 4 - Stand up org, Space, and Collection (Priority: P2)

As Vizuh, I need the Hugging Face org/profile, the Space, the datasets,
and a Collection bundling Space + Datasets (+ Papers, + optional future
model) into one public page — with GitHub/npm clearly canonical.

**Why this priority**: Discoverability with correct attribution; the
Collection is the public front door.

**Independent Test**: Checklist-driven setup with link verification
(org → Space → datasets → Collection → GitHub/npm all resolve; canonical
sources labeled).

**Acceptance Scenarios**:

1. **Given** the Collection page, **when** reviewed, **then** Sabi is
   described as a routing tool, never a model, with install pointing at
   npm and source at GitHub.
2. **Given** a future learned router artifact, **when** added, **then** it
   enters as a separate Model repo with its own card (never retrofitted
   into the tool presentation).

### Edge Cases

- Space build drift (dependency updates break the demo); pinned container
  with rebuild checklist.
- Dataset Takedown/privacy report; versioned yank procedure with reason.
- API schema must evolve; additive-only rule with version negotiation.
- Live-inference mode abuse (visitors spending Sabi keys); recorded mode
  default, live mode requires visitor keys with caps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST expose a versioned public JSON trajectory/decision
  API with schema, additive-only evolution, and adversarial redaction
  tests.
- **FR-002**: The Space MUST render a scripted trajectory with every
  figure traceable to a record, estimates-discipline cost presentation,
  and working GitHub/npm links; recorded mode MUST work offline.
- **FR-003**: Datasets MUST build reproducibly (content-hash stable) with
  quarantine counts, schema conformance, and cards stating method/limits/
  non-claims.
- **FR-004**: Org/Space/datasets/Collection MUST present Sabi as a routing
  tool with GitHub/npm canonical; learned artifacts MUST be separate
  repos if they ever exist.
- **FR-005**: Live-inference options MUST default off with visitor-key +
  cap requirements documented.

### Non-Functional Requirements

- **NFR-001**: API serialization MUST be deterministic for identical
  inputs.
- **NFR-002**: No raw prompts, secrets, paths, or tool arguments in API
  output, Space content, or datasets (adversarial fixtures).
- **NFR-003**: No test may require Hugging Face credentials or network;
  fixture app builds and dataset builds run locally.
- **NFR-004**: Space container MUST build reproducibly (pinned base) with
  a documented rebuild checklist.

### Key Entities

- **PublicTrajectoryAPI**: versioned schema + serializer + redactor.
- **DemoTrajectory**: scripted fixture with per-round expected display.
- **DatasetBuild**: corpus snapshot → sanitizer → versioned dataset +
  content hash + quarantine report.
- **HfPresence**: org/Space/datasets/Collection link map + canonicals.

## Success Criteria *(mandatory)*

- **SC-001**: API fixtures validate schema versions, compatibility, and
  redaction; zero regressions.
- **SC-002**: The Space app builds/runs locally with figure-to-record
  traceability and honest cost presentation.
- **SC-003**: Dataset builds are reproducible, quarantined, and carded
  with limits.
- **SC-004**: Presence checklist resolves all links with correct
  tool-not-model framing and canonicals.

## Assumptions

- Hugging Face Spaces supports the chosen runtime (Gradio/static/Docker
  verified at build time; cite docs date).
- Specs 004 (chain views, metric catalog) and 010 (corpus) feed the Space
  and datasets; this feature integrates, it does not rebuild them.
- Vizuh owns/creates the HF org; credentials stay out of the repo (env
  only, per secrets rule).

## Out of Scope

- Mirroring Sabi source or npm packages onto Hugging Face.
- Training or publishing a learned router model (separate future decision
  with its own spec).
- Running live benchmarks on the Space (recorded trajectories only).
- Community support/forum commitments beyond the presence checklist.
