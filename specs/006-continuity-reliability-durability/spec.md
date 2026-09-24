# Feature Specification: Continuity, Reliability Plane, Durable State

**Feature Branch**: `006-continuity-reliability-durability`

**Created**: 2026-09-23

**Status**: Planned

**Input**: Architecture synthesis — safe switching (vLLM SAAR's must-not vs
prefer-not distinction), LiteLLM-style reliability substrate, SQLite/WAL
durable controller state. Sabi has cache-aware same-tool-cycle pinning,
bounded process-local health, simple transportFallback, JSONL decisions, and
daemon state; adapter growth will expose all three layers to chaos.

## Context: what already exists

- `packages/core/src/cache-routing.ts`: same-tool-cycle/new-phase/failure
  phase model with keep/evaluate/switch actions and cost economics.
- Transport/rate-limit handling and per-harness model health are deliberately
  bounded and process-local; `transportFallback` retries one tier up.
- Controller registry persists bounded receipts/capsule metadata; JSONL is
  the decision log; no crash recovery, transactions, or cross-process reads.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Never switch when switching is invalid (Priority: P1)

As the scheduler, I need a ContinuityState (affinity none/preferred/required,
reason, physical route, portability, release conditions) so the pipeline
first answers "can I switch?" (pin when required) and only then "should I
switch?" (cost/capability/effort) — with tool-loop and provider-state locks
that release on defined boundaries.

**Why this priority**: The top correctness gap: a mid-tool-loop model switch
sends `tool_result abc123` to a model that never emitted the call.

**Independent Test**: Fixture trajectories with open tool loops, portable vs
non-portable provider state, and cache pressure; assert required-affinity
pins regardless of economics, preferred-affinity weighs cache cost, and
release fires exactly on cycle-complete/reset/phase/session boundaries.

**Acceptance Scenarios**:

1. **Given** an open tool loop on a physical route, **when** a cheaper route
   is proposed, **then** the decision stays pinned with reason `tool-loop`
   until cycle-complete releases it.
2. **Given** non-portable provider state (server conversation IDs, encrypted
   reasoning state), **when** a switch is proposed, **then** affinity is
   `required` and the switch is refused, not merely uneconomical.
3. **Given** portable state with only cache economics against switching,
   **when** a much better route appears, **then** affinity is `preferred`
   and the switch may proceed with the cache cost recorded.

---

### User Story 2 - Classify failures before reacting (Priority: P1)

As the recovery planner, I need a failure taxonomy — reasoning, provider,
transport, capability, entitlement, quota, policy refusal, harness — so a
429, a removed model, and a bad argument never all mean "try stronger model".

**Why this priority**: Extends 001 hard gates and 002 `switch-harness` with
the vocabulary reliability policy needs.

**Independent Test**: Fixture failure signals across all eight classes;
assert each maps to its class and to the class-appropriate intervention
family (retry/backoff/failover/refuse/escalate), never a bare tier step-up.

**Acceptance Scenarios**:

1. **Given** a 429 + Retry-After, **when** classified, **then** class is
   `quota` and the intervention is backoff + budget-aware retry, not
   escalation.
2. **Given** model-removed/renamed or not-entitled, **when** classified,
   **then** class is `entitlement` and the route is removed with a
   user-visible reason.
3. **Given** a policy refusal, **when** classified, **then** no retry,
   failover, or escalation is planned; the outcome is recorded and surfaced.

---

### User Story 3 - Survive provider chaos with boring infrastructure (Priority: P2)

As Sabi serving many adapters, I need per-provider/model/harness health,
circuit breakers, cooldowns, exponential backoff + jitter, retry budgets,
max concurrency, rate windows, deadline + cancellation propagation, and
same-model-different-provider fallback — so outages degrade gracefully
instead of cascading.

**Why this priority**: The reliability substrate competitors spent years on;
Sabi needs the concepts, not their scale.

**Independent Test**: Fixture chaos scripts (outage, flapping, slow-first-byte,
mid-stream death, saturation); assert breaker opens/closes on thresholds,
budgets cap retries, deadlines propagate, and fallback prefers provider
change before model change for transport-class failures.

**Acceptance Scenarios**:

1. **Given** consecutive failures past threshold, **when** the breaker opens,
   **then** requests fail fast with receipts until cooldown, then half-open
   probes.
2. **Given** a saturated route with a healthy same-model alternate provider,
   **when** fallback runs, **then** provider changes first; model changes
   only for reasoning-class failures.
3. **Given** a total deadline, **when** dispatching nested calls, **then**
   remaining budget propagates and cancellation cancels the whole chain.

---

### User Story 4 - Restart without losing the session (Priority: P2)

As the Sabi daemon serving many sessions, I need SQLite + WAL durable
controller state (atomicity, idempotency, transactions, crash recovery,
indexes, bounded retention, cross-process reads, migrations) with JSONL
kept as export/debug format — so restarts, partial writes, duplicates, and
late receipts stop corrupting routing.

**Why this priority**: Boring but load-bearing once many harnesses share one
daemon; local and zero-admin via `node:sqlite` (no new dependency).

**Independent Test**: Fixture crash scenarios (kill mid-write, duplicate
delivery, late handoff receipt, two writers); assert atomic commits,
idempotent replays, recovered state, and bounded retention enforcement.

**Acceptance Scenarios**:

1. **Given** a kill between decision write and receipt arrival, **when** the
   daemon restarts, **then** state recovers to the last committed point and
   the late receipt attaches without duplication.
2. **Given** retention bounds, **when** enforcement runs, **then** oldest
   records compact deterministically with an export snapshot first.
3. **Given** a schema change, **when** migrating, **then** versioned
   migrations run in transactions with rollback on failure.

### Edge Cases

- Affinity required by two competing reasons; the stricter release wins.
- Breaker half-open probe races with a real request; single-flight probes.
- Clock skew across processes; monotonic durations, wall-clock only for
  display.
- SQLite lock contention under burst; WAL + busy-timeout + bounded retries.
- Deadline already expired at dispatch; fail fast with a receipt, never send.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sabi MUST define ContinuityState (affinity, reason, physical
  route, portability, release conditions); `required` affinity MUST pin
  regardless of cost/quality arguments.
- **FR-002**: The route pipeline MUST evaluate can-switch before
  should-switch; refusals MUST carry reasons into receipts.
- **FR-003**: Failures MUST classify into the eight classes; each class MUST
  map to its intervention family (never bare tier step-up for
  non-reasoning classes).
- **FR-004**: Health/breaker/cooldown/backoff/retry-budget/concurrency/
  deadline/cancellation MUST be implemented per provider/model/harness with
  fixture-observable thresholds.
- **FR-005**: Fallback order MUST prefer same-model provider change for
  transport-class failures before model change.
- **FR-006**: Controller state MUST persist in SQLite/WAL with idempotent
  writes, crash recovery, bounded retention, and versioned migrations;
  JSONL remains as export/debug.
- **FR-007**: Existing cache-routing economics MUST be preserved and feed
  `preferred` affinity; the feature extends pinning, it does not replace
  the economics.

### Non-Functional Requirements

- **NFR-001**: Affinity, classification, and breaker transitions MUST be
  deterministic for identical event sequences.
- **NFR-002**: SQLite MUST use `node:sqlite` only — no new runtime
  dependency; files stay under user config scope with 0600 permissions.
- **NFR-003**: No test may require paid inference, live providers, or live
  harnesses; chaos is scripted fixtures.
- **NFR-004**: Breaker fast-fail MUST bound tail latency under outage
  fixtures (measured).

### Key Entities

- **ContinuityState**: affinity + reason + route + portability + release.
- **FailureClass**: eight-way taxonomy with intervention mapping.
- **HealthRecord**: per-route consecutive failures, breaker state, cooldown,
  concurrency/rate usage, deadline ledgers.
- **DurableStore**: SQLite schema, migrations, retention policy.

## Success Criteria *(mandatory)*

- **SC-001**: Affinity fixtures pin on required, weigh on preferred, release
  exactly on boundaries; zero regressions in cache-routing tests.
- **SC-002**: All eight failure classes classify correctly with
  class-appropriate interventions in fixtures.
- **SC-003**: Chaos fixtures show bounded retries, fast-fail on open
  breakers, provider-before-model fallback order.
- **SC-004**: Crash/duplicate/late-receipt fixtures recover exactly once
  with retention enforced.

## Assumptions

- Specs 002 (receipts) and 005 (IR/Decision) are the integration surfaces.
- `node:sqlite` availability (Node ≥22.5) is the only platform assumption.
- Health signals start fixture-declared; live provider signals arrive via
  later adapter work, not this feature.

## Out of Scope

- Distributed/multi-host state (single local daemon only).
- Redis or any server process; hosted fallback or load balancing across
  machines.
- Live provider health feeds (interfaces ready, feeds later).
