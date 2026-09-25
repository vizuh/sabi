# Feature Specification: Fleet Evidence and Health

**Feature Branch**: `013-fleet-evidence-and-health`

**Created**: 2026-09-25

**Status**: Planned

**Input**: Architecture synthesis — turn the existing `RoundReceipt` into a
real evidence plane. Today a round is classified by `classifyFailure(status)`,
which is a four-branch integer mapping. The synthesis argues for scoped failure
classification, honest success detection, immediate local circuits, a
consume-only health overlay with a TTL, and opt-in pseudonymous telemetry.

**Relationship to 010**: 010 is *shadow routing* — mirror live decisions
without changing them, then turn mirrors into evaluation. This spec is the
**live reaction path**: it changes what the router does on the next round. 010's
mirrors are the local dataset that can later justify a 010 Phase 3 promotion.
They are complementary and must not be merged.

**Relationship to 012**: 012 scores a round and picks a tier from accumulated
evidence. This spec changes **what a round contributes** to that scorer — a
failure it can attribute to its account must not read as a model failure.

## Context: what already exists

- `RoundReceipt` records `requestedModel`, `actualModel`, `identityMatch`,
  `substituted`, `selectedProvider`, `selectedModel`, `status`, `latencyMs`,
  `outcome`, `failureCode`, and a truncated upstream `detail`.
- A named model is pinned: a failing model is never answered by a different
  one. An unpinned request may walk the candidate list.
- `classifyFailure` is `429 → rate-limited`, `402/403 → refused`,
  `≥500 → server-error`, everything else → `transport`.
- The candidate walk is the existing local recovery path.
- `sabi-code` has a `RoundReceipt`-equivalent in `apps/gateway/src/server.ts`
  with the same primitive classifier, and a five-probe capability harness.

## Confirmed defects this spec exists to fix

1. **HTTP 200 is treated as success.** In `sabi-code`'s gateway the success
   branch is entered on `response.ok`, and the body is then read for
   `model`. A 200 carrying `{"error": {...}}` with no `choices` is recorded as
   `outcome: 'ok'`. Confirmed by inspection, not inferred. An upstream that
   commits a 200 and then fails would be taught that failing routes work.
2. **Classification has no scope.** A 429 from a user's exhausted free quota and
   a 429 from a provider being hammered are the same value, so a user-specific
   condition can suppress a route fleet-wide.
3. **404 is read as "model gone".** Upstream privacy/provider restrictions can
   produce a 404 for a perfectly healthy model on one account.
4. **No circuit, no memory.** Every round re-attempts a route the previous round
   just failed, because nothing persists the failure.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A failed round is attributed correctly (Priority: P1)

As a developer, when a round fails, I need Sabi to know *why* and *whose fault
it is*, so that one person's exhausted quota never takes a working model out of
service for everyone.

#### Acceptance Criteria

1. **A 200 with an error body is a failure.** When an upstream returns HTTP 200
   whose body contains an `error` and no `choices`, the receipt MUST record
   `outcome: 'error'`, MUST NOT record `outcome: 'ok'`, and the gateway MUST NOT
   return it to the caller as a completion.
2. **Streaming errors are failures.** An SSE stream that ends with an error
   event, or a chunk carrying `finish_reason: 'error'`, MUST be classified as a
   failure even though the HTTP status was 200.
3. **Every failure carries a scope.** `classify()` MUST return one of
   `request | account | model | provider | openrouter | network | sabi | unknown`.
4. **A scope implies a fleet effect.** The classification MUST yield a
   `healthEffect` of `none | local_cooldown | capability_penalty |
   route_penalty | global_candidate_removal`, and the mapping MUST be
   deterministic and table-driven.
5. **A 404 never globally removes a model on one observation.** Scope for a 404
   MUST NOT be `model` unless corroborated by an active probe or the provider
   catalogue.
6. **Upstream `error_type` wins over the HTTP status.** When the body carries a
   recognized `error_type`, the classifier MUST use it in preference to the
   status code.

#### Testing

- Fixture table: one case per `error_type` × scope, asserting the exact scope
  and health effect.
- A 200-with-error fixture asserting `outcome: 'error'` and that no capability
  signal is emitted.
- An SSE fixture with a mid-stream error asserting the same.
- A 404 from one install asserting **no** global effect.

### User Story 2 - The router recovers locally, immediately (Priority: P1)

As a developer on a flaky free tier, I need the next round to go somewhere else
without waiting for a network service, so a bad route costs me one round rather
than one round per attempt.

#### Acceptance Criteria

1. **A local circuit opens on a scoped failure.** A failure whose health effect
   includes `local_cooldown` MUST open a per-route circuit in the local router.
2. **The next round skips an open circuit.** An open circuit MUST be excluded
   from candidate selection without a network call.
3. **Local recovery never requires the control plane.** With the Sabi service
   entirely unreachable, the router MUST continue selecting routes and MUST
   continue recovering from failures.
4. **A circuit expires.** Open circuits MUST carry a half-open probe after a
   bounded interval, and MUST close on the first success.
5. **Scope decides the blast radius.** An `account`-scoped failure MUST open the
   circuit for that account only and MUST NOT contribute fleet evidence.

#### Testing

- A sequence of rounds against a failing route asserting the second round does
  not re-attempt it.
- A control-plane-down test asserting routing still works.
- A half-open test asserting one probe then close.

### User Story 3 - Fleet health improves the local default, then expires (Priority: P2)

As a developer, I want routes that are broken for everyone to stop reaching me,
without a cloud service being able to permanently disable a model on my
machine.

#### Acceptance Criteria

1. **The overlay is advisory and signed.** Health records MUST carry a
   `confidence`, an `independent_installs` count, `issued_at` and `expires_at`.
2. **An expired overlay is ignored.** The router MUST drop any record past
   `expires_at` and MUST NOT keep a model suppressed because a feed stopped
   updating.
3. **A last-known-good overlay survives a fetch failure.** A failed or empty
   fetch MUST NOT clear the currently held overlay before its own expiry.
4. **The overlay is a penalty, not a veto.** A health penalty MUST change route
   score, not eligibility, unless the record explicitly carries
   `global_candidate_removal`, which requires the strongest evidence class.
5. **Single-observer reports never reach fleet state.** One install's report
   MUST NOT produce a fleet overlay; the aggregation service enforces a minimum
   distinct-installer count.

#### Testing

- A fixture overlay with `expires_at` in the past asserting it is ignored.
- A feed-failure test asserting the held overlay is retained.
- A control-plane-offline test asserting routing is unaffected.

### User Story 4 — Telemetry is opt-in and inspectable (Priority: P2)

As a developer whose code and keys are the product's core promise, I need to see
exactly what leaves my machine, and refuse it, without losing the free router.

#### Acceptance Criteria

1. **The router works with telemetry off.** Every routing, escalation, and
   recovery behaviour MUST function identically with no consent record.
2. **The payload is a closed type.** The event type MUST NOT have a field for
   prompt, completion, source, path, filename, command, tool arguments, key,
   authorization header, raw error text, email, or full IP. This is a type
   constraint, not a policy document, and MUST fail to compile if a field is
   added.
3. **Error text never leaves the machine.** The normalized event carries a
   `error_type` and optional `provider_code`; the raw `detail` string MUST be
   excluded and MUST be absent from the wire fixture.
4. **Preview shows the next payload.** `sabi telemetry preview` MUST print the
   exact next JSON payload, byte-for-byte what would be sent.
5. **Withdrawal is immediate and total.** `sabi telemetry off` MUST stop
   emission, MUST clear the queue, and MUST delete the installation's
   pseudonymous identifier.
6. **Reliability and diagnostics are separate permissions.** Enabling
   reliability MUST NOT enable diagnostics.
7. **Consent is never preselected and never inferred from payment.** A paying
   Live entitlement MUST NOT be treated as telemetry consent.

#### Testing

- A serialization test asserting the wire JSON has no forbidden key at any
  nesting depth.
- A test asserting a receipt carrying a raw upstream error containing a
  path-like string does not place that string in the event.
- A type-level test asserting the forbidden field list cannot be extended.
- An off/withdraw test asserting the queue empties and the id is gone.

### User Story 5 — Quota state is a first-class local fact (Priority: P2)

As a developer with a daily free allowance, I need the router to know my quota
is spent without a round trip, so it stops routing to a lane I cannot use.

#### Acceptance Criteria

1. **Quota is enumerated, not numeric in the event.** The event carries
   `quota_state: healthy | low | exhausted | unknown`; the numeric balance MUST
   NOT appear in fleet telemetry.
2. **The check runs locally with the user's key.** The provider quota check MUST
   execute in the local router using the operator's own credential. Sabi MUST
   never receive the key to perform it.
3. **A 429 resolves to a scope.** When a 429 occurs, the router MUST determine
   whether it is an account quota or provider capacity, using provider rate
   limit metadata where available, and MUST record the resolved scope.
4. **An account-scoped 429 opens a local cooldown only.**

#### Testing

- A fixture with provider quota headers asserting `account` scope.
- A fixture with provider-origin metadata asserting `provider` scope.
- An event-shape test asserting no numeric balance is present.

## Requirements

### R1 — Scoped classification

```ts
export type FailureScope =
  | 'request' | 'account' | 'model' | 'provider'
  | 'openrouter' | 'network' | 'sabi' | 'unknown'

export type HealthEffect =
  | 'none' | 'local_cooldown' | 'capability_penalty'
  | 'route_penalty' | 'global_candidate_removal'

export interface FailureClassification {
  scope: FailureScope
  effect: HealthEffect
  errorType?: string
  providerCode?: string
  retryAfterBucket?: string
  /** Never leaves the machine. */
  detail?: string
}
```

`classify()` MUST be pure, table-driven, and total: every
`(status, error_type, provider_code)` triple yields a result, and an
unrecognised input yields `scope: 'unknown'`, `effect: 'none'` rather than a
guess. An unknown failure MUST NOT be allowed to penalise anything.

### R2 — Honest success

Success MUST require a body that is actually a completion. A receipt MUST NOT
record `outcome: 'ok'` for a response that carries an error, is missing
`choices`, or ends a stream with an error event.

### R3 — Local circuit state

Circuit state is per `(provider, model)` and per account. It MUST be
in-process, bounded in size, and MUST NOT require the control plane. Half-open
probing MUST emit at most one probe per cooldown interval.

### R4 — Health overlay consumption

The router consumes a signed, expiring overlay. Overlay application MUST be
idempotent and order-independent: an older record MUST NOT overwrite a newer
one. An unparseable or unsigned overlay MUST be ignored, not partially applied.

### R5 — Privacy-minimized telemetry

The emitted event is a closed type. Aggregation happens on the router before
transmission, so the denominator travels with the failures. Prompt, completion,
source, path, filename, command, tool arguments, credentials, headers, raw
error text, account identifiers, and full IP addresses MUST NOT be emitted in
any form.

### R6 — Consent

Consent is versioned, per-installation, per-purpose, revocable, and never
implied by payment. A router with no consent record MUST behave exactly as a
router with consent declined.

### R7 — Fail-open

No control-plane dependency may appear on the request path. Every feed read,
consent check, and telemetry send MUST be off the critical path and bounded in
time.

## Out of Scope

- **Fleet aggregation, overlay compilation, and the ingest API.** These are
  Sabi Live service concerns and are specified in the companion sabi-code spec.
- **ClickHouse, Kafka, or any streaming infrastructure** in the router.
- **Replacing the candidate walk.** Local recovery already works; this spec
  makes it informed and persistent, not different in kind.
- **Any change to what a model is good at.** Capability learning stays in
  sabi-code's probe harness.

## Success Criteria

- [ ] A 200-with-error response is never recorded as a successful round.
- [ ] Every failure has a scope, and no single-install report can produce a
      fleet effect.
- [ ] A failing route is not re-attempted on the immediately following round.
- [ ] The router routes correctly with the control plane unreachable.
- [ ] The wire payload provably contains no forbidden field, and the forbidden
      list is a compile error to extend.
- [ ] `telemetry preview` output is byte-identical to what a send would emit.
- [ ] With telemetry declined, zero bytes are produced.
- [ ] A user can withdraw consent and the queue is empty within the flush
      interval.
