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
3. `packages/server/src/compatibility.ts:104`: paid models are allowed unless
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
| `unconfigured` | key reference does not resolve **before** the call | upstream | until config or env changes (restart) | exclude upstream, no call spent | "not configured" |
| `credential` | 401 with a resolved key | upstream × key | until config changes | exclude upstream; fall back only to tiers the operator allowed | "key rejected" |
| `not-entitled` | 402, or 403 whose body matches a known plan/entitlement pattern | account × model | hours (default 6h), or until config changes | route around without a call | "not on plan" |
| `quota` | 429 with platform `X-RateLimit-*` (#151) | pool | until the reset header, else default | skip pool members | "quota spent" |
| `transient` | 429 without platform headers, 5xx, network | model | seconds to a minute (today's behaviour) | fall back this round only | "failing" |

Rules:

- **Classify conservatively.** An unknown 403 stays `transient`. `not-entitled`
  needs a status plus a body match from a short list kept in code with the
  provider it came from.
- **A configuration class never buys a paid tier.** `unconfigured` and
  `credential` may fall back only to free tiers unless the operator set an
  explicit opt-in (name TBD, off by default). Otherwise the round fails with an
  error that names the upstream and the environment variable reference, never
  its value.
- **State lives in the proxy process**, keyed as in the table, and is not
  persisted. A restart clears it; that is acceptable because restart is also
  how env changes take effect.
- Every class the router acts on is written to the decision record
  (`upstreamRefusal: { class, upstream, model?, status? }`) so it appears on
  the dashboard and in `sabi replay`.

## Decision to take (Hugo)

For `unconfigured` when no free tier is left:

- **A. Fail the round loudly** (proposed): 502-style error naming the upstream
  and variable. Surfaces the mistake at the first round.
- **B. Skip with reason and serve from any remaining tier.** Keeps work moving
  but is exactly the hermes-agent#107874 billing failure if that tier is paid.

## Acceptance

- The fixture above returns an error or a free-tier answer; `paidup` receives
  zero calls; the record carries `upstreamRefusal.class: unconfigured`.
- A 401 from a configured key is recorded as `credential`, not `unconfigured`.
- A 403 with a known not-in-plan body is called once; the next round within
  the TTL routes around it with zero calls to that model.
- An unknown 403 behaves exactly as today.
- Existing `transport-fallback` and #151 quota tests stay green.

## Out of scope

- Probing entitlement ahead of time (listing a plan's models). Catalogue
  listing is not entitlement; see spec 023.
- Persisting refusal state across restarts.
