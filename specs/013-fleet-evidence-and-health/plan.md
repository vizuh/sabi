# Implementation Plan: Fleet Evidence and Health

**Branch**: 013-fleet-evidence-and-health | **Date**: 2026-09-25 | **Spec**:
[spec.md](./spec.md)

## Summary

Make a round's outcome mean something. Three bounded changes, in order of blast
radius: classify failures by scope so a user's exhausted quota cannot suppress a
route; stop treating HTTP 200 as success; and add an in-process circuit so the
next round skips a route the last round just failed. Then, separately and
strictly opt-in, emit a closed, privacy-minimized aggregate to Sabi Live and
consume a signed expiring health overlay.

The router never gains a hard dependency on the control plane. Everything added
here is either pure and local, or optional and off the request path.

## Technical Context

TypeScript 5.9, Node ≥22.6. No new runtime dependency. The classification table
is data, not logic, so it can be reviewed without reading control flow. The
telemetry event is a TypeScript type with no escape hatch, because the privacy
promise is only worth what the compiler enforces.

## Constitution Check

- **Native Harness, Bounded Scheduler** — PASS. Classification narrows which
  candidates remain eligible; it does not touch the harness loop.
- **Evidence Before Adaptation** — PASS, and this spec is the implementation of
  it. A failure without a scope is `unknown` and penalises nothing, which is
  the existing principle applied one layer down.
- **Deterministic Safety Gates** — PASS. `classify()` is a pure table with a
  total function; an unrecognised input cannot escalate. Cooldown is bounded
  and expiring rather than a permanent veto.
- **Testable Contracts and Receipts** — PASS. Every new type is named, the
  classification table is fixture-driven, and the forbidden-field list is a
  compile-time assertion.
- **Privacy, Simplicity, Reversibility** — PASS. Consent is opt-in, `off`
  restores the previous behaviour exactly, and the wire type makes the
  disclosure inspectable rather than promissory.

## Project Structure

```text
packages/evidence/src/
├── types.ts          # FailureScope, HealthEffect, classification, overlay
├── classify.ts       # the table-driven classifier (new)
├── circuit.ts        # per-route in-process circuit state (new)
├── overlay.ts        # signed, expiring health overlay store (new)
├── telemetry.ts      # the CLOSED event type + serializer (new)
├── consent.ts        # versioned per-purpose consent record (new)
├── quota.ts          # local quota state, coarse buckets (new)
├── quota-free.ts     # provider quota adapter: healthy|low|exhausted|unknown
└── index.ts
packages/evidence/test/
├── classify.test.ts  # table fixtures, one per error_type
├── success.test.ts   # 200-with-error, SSE error, finish_reason
├── circuit.test.ts   # cooldown, half-open, account scope
├── overlay.test.ts   # expiry, staleness, signature, fail-open
├── telemetry.test.ts # forbidden-field scan, detail exclusion
└── consent.test.ts   # off == never consented; withdrawal empties the queue
apps/sabi-cli/src/
└── telemetry.ts      # status | preview | on | off | export | delete
```

## Design Decisions

### The classification is data

A table keyed on `(status, error_type, provider_code)` rather than a chain of
branches. The current `classifyFailure` is four branches and cannot represent
scope; adding scope as nested conditionals would produce something nobody can
review against a table of expected outcomes.

### Unknown penalises nothing

`scope: 'unknown'` maps to `effect: 'none'`. An unrecognised error is not
evidence of anything, and a fleet that punishes what it cannot explain will
learn to suppress routes for reasons it cannot name.

### 404 is never a one-observation model removal

Upstream account-level privacy and provider restrictions can produce a 404 for
a model that is entirely healthy. `not_found` classifies to a scope that may
open a local cooldown but MUST NOT produce `global_candidate_removal` without
corroboration.

### The forbidden list is a type, not a document

```ts
// Adding a field here is a design decision that must survive review.
// The compiler will not stop you; the test will.
const FORBIDDEN_EVENT_KEYS = [
  'prompt', 'completion', 'source', 'path', 'filename', 'command',
  'tool_arguments', 'key', 'authorization', 'headers', 'detail',
  'email', 'ip', 'account_id', 'router_token',
] as const
```

A test walks the serialized event at every nesting depth and fails on any of
these. The point is that it is a test rather than a promise, so it fails in CI
when someone adds a field out of habit.

### Aggregation happens on the router

The router sends a 60-second aggregate plus individual normalized failures, so
the fleet receives the denominator. A failure-only feed cannot distinguish 10
failures from 20 attempts and 10 from 1,000.

### Separate permissions

`reliability` and `diagnostics` are distinct. Enabling one MUST NOT enable the
other. `diagnostics` may carry provider error text and is manual and
per-incident; `reliability` never carries error text at all.

### Pseudonymous, never anonymous

A rotating installation id is required to count independent observers and to
support deletion. It is not anonymity, and the docs must not call it that. The
billing identity is used at ingest to verify entitlement and is then stripped
before the event is written.

## Phase Order

1. **Classification** — pure, no behaviour change yet.
2. **Honest success** — the 200-with-error defect. Small, severe, independent.
3. **Circuit** — the first behaviour change, entirely local.
4. **Telemetry + consent** — opt-in surface, off by default.
5. **Overlay** — consumption only; requires the service to exist first.

Phase 2 is deliberately early and independent. It is a confirmed defect and
nothing else should wait on it.

## Verification Strategy

- Every classifier row is a named fixture asserting `(scope, effect)`.
- Success detection is tested against a literal 200-with-error body, because
  the bug is precisely that the body was not read.
- Circuit behaviour is tested as a *sequence* of rounds, since a single round
  cannot demonstrate that the next one was skipped.
- Overlay expiry is tested with a fixture in the past, not a mocked clock alone.
- The telemetry forbidden-field scan runs against a real serialized event
  containing a receipt whose `detail` contains a path-like string.
- Control-plane-down is tested by pointing the client at a closed port, not by
  stubbing the client.
