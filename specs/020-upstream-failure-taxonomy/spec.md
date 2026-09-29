# Feature Specification: Upstream Failure Taxonomy

**Feature Branch**: `spec/routing-evidence`
**Created**: 2026-09-29
**Status**: Draft
**Issues**: #155 (missing key routes to paid), #156 (not-entitled treated as transient). Builds on #151 (platform-quota 429).

**Input**: an upstream refusal is not one thing. A key that was never set, a
key that was revoked, a model the plan does not include, a spent shared quota
and a provider hiccup each need a different scope, lifetime and routing
effect. Today the proxy folds them into "transport failure, try the next tier".

---

## Current behaviour (observed)

**#155 reproduced on 2026-09-29** against `main` at `83e6b24`, with a throwaway
fixture (two mock upstreams through `createSabiServer`):

- `freeup`: `apiKey: '$SABI_REPRO_MISSING_KEY'` (unset), free model, answers
  401 when no `Authorization` header arrives.
- `paidup`: paid model (`cost.input: 5`), accepts anything.
- `transportFallback.enabled: true`, `policy.unclassified: cheap` (free tier).

Result: HTTP 200 to the client. Upstream calls were
`free-primary auth=no -> paid-fallback auth=no`. The decision record shows
`tier: strong`, `upstream: paidup`, `fallback: strong`, `cost.total: 0.00525`.
A configuration error was served silently on the paid tier.

Code path:

1. `packages/server/src/upstream.ts:68`: `callerToken ?? resolveKey(upstream.apiKey)`.
   An unresolved reference sends the request with no `Authorization`.
2. `packages/server/src/server.ts:782`: 401 is `credentialFailure`; the chain
   drops the same upstream and continues to the next one.
3. `packages/core/src/compatibility.ts:104`: paid models are allowed unless
   `paidModelsAllowed: false`.
4. `packages/server/src/server.ts:53` (`credentialWarnings`) only warns once at
   startup.

**#156 by code reading, not reproduced:** `server.ts:766` treats 402 and 403
like 429. Nothing is remembered across rounds, so a model outside the plan is
tried first on every round. `packages/controller/src/model-health.ts` keeps a
60-second TTL, which fits outages, not entitlements.

## Classes

| Class | Evidence | Scope | Lifetime | Routing effect | Dashboard label |
|---|---|---|---|---|---|
| `unconfigured` | `apiKey` is a `$VAR` reference, the variable is unset, no borrowed caller token, not `auth: passthrough` | upstream | until env changes (restart) | no call; fall back to **free tiers only**; otherwise fail | "key not set" |
| `credential` | 401 with a resolved key | upstream | this round | leave the upstream; fall back under today's `paidModelsAllowed` rules (unchanged) | "key rejected" |
| `not-entitled` | 402 or 403 **and** a body match (see below) | upstream × model | 6h in process | first time: fall back; within the TTL: route around with no call | "not on plan" |
| `quota` | 429 with platform `X-RateLimit-*` (#151) | pool | this round (existing, #151) | skip pool members | "quota spent" |
| `transient` | anything else, including unknown 402/403 | model | this round (today's behaviour) | fall back this round only | "provider error" |

Rules:

- **`unconfigured` is narrow.** An omitted `apiKey` is a keyless upstream on
  purpose (local servers, many test fixtures) and behaves exactly as before.
- **Classify conservatively.** `not-entitled` needs a status and a body match.
  A bare 402 is usually account credit, which a top-up fixes; latching it for
  hours would be wrong. The only pattern today is the wording observed in
  NousResearch/hermes-agent#123362 ("model is not available in the current
  token plan"). Add another provider's wording only with a cited example.
- **Only a missing key is barred from paid tiers.** A 401 from a resolved key
  keeps cross-upstream fallback: one expired key stranding every working tier
  was a deliberate fix (comment at the 401 branch in `server.ts`). No opt-in
  exists to let `unconfigured` reach a paid tier; add one when someone asks.
- **A borrowed caller credential is another account.** Neither
  `unconfigured` nor a remembered `not-entitled` applies to it, and a refusal
  under it is not remembered.
- **State lives in the proxy process** and is not persisted. A restart clears
  it, which is also how env and plan changes take effect.
- Every classified failure of the planned upstream is written to the decision
  record as `upstreamRefusal: { class, upstream, status? }` (`status` absent
  when no call was made), and shown on the dashboard and in `npm run report`.
- Cross-round quota memory (lifetime "until the reset header") is **not**
  built; #151's per-round behaviour stands. Trigger to build it: a log showing
  repeated calls into a pool that was already exhausted.

## Decision

For `unconfigured` when no free tier is left, **A. fail the round loudly**
(defaulted on 2026-09-29; Hugo asked to implement without choosing). The
client gets a 502 whose message names the upstream and the variable, never
its value. This also applies to fixed aliases and to rounds with transport
fallback off, which used to receive the provider's unauthenticated 401. The
missing-key error is served even when a free fallback also fails, so a free
tier's 503 cannot hide it.

## Acceptance

- The fixture above returns an error or a free-tier answer; `paidup` receives
  zero calls; the record carries `upstreamRefusal.class: unconfigured`.
- A 401 from a configured key is recorded as `credential`, not `unconfigured`,
  and still falls back across upstreams as before.
- An omitted `apiKey` is still called, without auth.
- A 403 with a known not-in-plan body is called once; the next round within
  the TTL routes around it with zero calls to that model.
- An unknown 403 or a bare 402 behaves exactly as today.
- Existing `transport-fallback` and #151 quota tests stay green.

## Out of scope

- Probing entitlement ahead of time (listing a plan's models). Catalogue
  listing is not entitlement; see spec 023.
- Persisting refusal state across restarts.
