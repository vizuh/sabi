# Tasks: Fleet Evidence and Health

**Input**: `specs/013-fleet-evidence-and-health/spec.md`, `plan.md`
**Prerequisites**: 010 Phase 1–2 (shadow mirror) for the local dataset; none of
Phase 1–3 is blocked by 010.

## Phase 1: Classification (pure, no behaviour change)

- [ ] **T001** Add `FailureScope`, `HealthEffect`, `FailureClassification` to
  `packages/evidence/src/types.ts`. Total function, `unknown` is a legal scope.
- [ ] **T002** Write the fixture table first: one row per upstream `error_type`
  (rate_limit_exceeded, provider_overloaded, provider_unavailable,
  context_length_exceeded, payment_required, not_found, invalid_request,
  content_policy_violation) × expected scope × expected effect. Written
  failing.
- [ ] **T003** `classify(input)` in `classify.ts`, table-driven. `error_type`
  beats status. Unrecognised input → `{scope: 'unknown', effect: 'none'}`.
- [ ] **T004** Property tests: no input produces `global_candidate_removal`;
  `not_found` never maps to scope `model`; the function is total over the
  fixture space.
- [ ] **T005** Wire `classify()` into the gateway receipt path alongside the
  existing `classifyFailure`, which stays for one release as a fallback.

## Phase 2: Honest success (severe, independent — do early)

- [ ] **T010** Treat a 200 whose body carries `error` and no `choices` as
  `outcome: 'error'`. Confirm the current defect with a failing test first: a
  200-with-error body currently records `outcome: 'ok'`.
- [ ] **T011** Classify an SSE stream that terminates with an error event, and
  a final chunk with `finish_reason: 'error'`, as failures.
- [ ] **T012** Do not return an error-bodied 200 to the caller as a completion.
  Return the gateway's own error shape with the classified failure.
- [ ] **T013** Ensure a false success cannot emit a capability signal. This is
  the whole point: the fleet must not learn that a failing route works.

## Phase 3: Local circuit (the first behaviour change, entirely local)

- [ ] **T020** `circuit.ts`: per `(provider, model)` state, open on
  `local_cooldown`, half-open after a bounded interval, closed on first success.
- [ ] **T021** Exclude open circuits from candidate selection without a network
  call.
- [ ] **T022** Account-scoped failures open a local cooldown only and MUST NOT
  create fleet evidence.
- [ ] **T023** Bound circuit memory. An unbounded map keyed by model id is a leak
  on a long-lived router.
- [ ] **T024** Sequence test: round N fails, round N+1 does not re-attempt it.
  A single-round test cannot show this.
- [ ] **T025** Control-plane-down test: point at a closed port and assert
  routing and recovery still work.

## Phase 4: Telemetry and consent (opt-in, off by default)

- [ ] **T030** `telemetry.ts`: the CLOSED event type. No field for prompt,
  completion, source, path, filename, command, tool arguments, key,
  authorization, headers, raw error text, email, IP, account id, router token.
- [ ] **T031** `consent.ts`: versioned, per-installation, per-purpose
  (`reliability`, `diagnostics`), revocable, never preselected, never inferred
  from payment.
- [ ] **T032** Assert declined consent is byte-identical to never having
  consented. A default-on code path is the failure this guards.
- [ ] **T033** Normalize `detail` into `error_type` + `provider_code` locally.
  The raw string MUST NOT be present in the serialized event, asserted with a
  receipt whose detail contains a path-like string.
- [ ] **T034** Router-side aggregation: 60-second window, attempts / successes /
  failures / latency buckets, so the denominator travels with the failures.
- [ ] **T035** Bounded queue with a flush interval. A router offline for a day
  MUST NOT accumulate an unbounded backlog on disk.
- [ ] **T036** `sabi telemetry status | preview | on | off | export | delete`.
  `preview` MUST print exactly the next payload that would be sent.
- [ ] **T037** Withdraw: stop emission, clear the queue, delete the rotating
  installation id.
- [ ] **T038** Wire the setup-time consent screen, neither option preselected,
  with a preview link.
- [ ] **T039** Forbidden-field scan test at every nesting depth of the
  serialized event.

## Phase 5: Health overlay (consume-only; service must exist first)

- [ ] **T050** `overlay.ts`: signed, expiring records with `confidence`,
  `independent_installs`, `issued_at`, `expires_at`, `penalty`.
- [ ] **T051** Drop records past `expires_at`. A model MUST NOT stay suppressed
  because a feed stopped updating.
- [ ] **T052** Retain last-known-good on fetch failure until its own expiry.
- [ ] **T053** Overlay applies a score penalty, not an eligibility veto, except
  for records carrying `global_candidate_removal`.
- [ ] **T054** Reject unsigned or unparseable overlays wholesale. No partial
  application.
- [ ] **T055** Idempotent and order-independent application: an older record
  MUST NOT overwrite a newer one.

## Phase 6: Quota state (local, coarse)

- [ ] **T060** `quota.ts` + `quota-free.ts`: local check with the operator's
  key. Sabi never receives the key to perform it.
- [ ] **T061** Enumerate `healthy | low | exhausted | unknown`. The numeric
  balance MUST NOT appear in fleet telemetry.
- [ ] **T062** On a 429, resolve to account quota or provider capacity using
  provider rate-limit metadata where present, and record the resolved scope.

## Dependencies

- Phase 1 blocks 2, 3, and 6.
- Phase 2 is independent and should land first.
- Phase 3 blocks nothing and can land with 1.
- Phase 4 blocks nothing; it is inert until consent is granted.
- Phase 5 requires the sabi-code ingest + overlay service to exist. Do not
  build a consumer for a feed that is not published.
- Phase 6 requires an adapter per provider; the first is OpenRouter.

## Explicit non-goals

- No fleet aggregation or overlay compilation here. That is the companion
  sabi-code spec.
- No Kafka, ClickHouse, or streaming infrastructure in the router.
- No change to the candidate walk's shape — only to what it knows.
- No capability learning. That stays in sabi-code's probe harness.
