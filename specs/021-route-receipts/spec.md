# Feature Specification: Route Receipts

**Feature Branch**: `spec/routing-evidence`
**Created**: 2026-09-29
**Status**: Draft
**Issues**: #157. Related: #146 (effort scheduling), spec 020 (refusal classes).

**Input**: a routing policy that cannot show what actually served cannot show
what it saved. openai/codex#32283 (comment of 2026-09-12) states the need from
the user side: without the effective model and effort, a user cannot tell
"role config ignored" from "fallback after an error".

---

## Current state

`DecisionRecord` (`packages/core/src/types.ts`) has the parts, not the triad:

- `tier`, `model`, `upstream`: what Sabi planned.
- `servedModel` (`types.ts:635`): set only when the observed upstream model
  matches a configured id (`server.ts:622`).
- `effort`, `effortSource` (`types.ts:627`): what the client requested; the
  `scheduled` source is reserved (#146).
- `fallback` (`types.ts:656`): the tier that served after a transport fallback,
  with no reason.

A reader has to join four fields and guess why they differ.

## Receipt

One optional object per record:

```ts
receipt?: {
  requested: { tier: string; model: string; effort?: string }
  effective: { tier: string; model: string; effort?: string; observed: boolean }
  reason?: 'explicit-route' | 'fallback' | 'refusal' | 'clamp' | 'host-override'
  refusal?: RefusalClass // spec 020, only when reason is 'refusal' or 'fallback'
}
```

- `requested` is Sabi's decision before any upstream call.
- `effective` is what served. `observed: true` only when the response named
  the model; otherwise it is the tier's configured model and says so.
  Effective effort is recorded only when the upstream reports it; never
  inferred.
- `reason` is present only when `requested` and `effective` differ. The list
  is closed; a new reason needs a spec change.
- Written by the proxy at `finish()` (`server.ts:862`, `server.ts:897`), the
  one place both sides are known. Existing fields stay for compatibility.

## Surfaces

- **Dashboard**: a "mismatch" count in the routing overview and, per row,
  `requested → effective (reason)` when they differ.
- **`sabi replay`**: mismatch count and reasons in the summary.
- **Host telemetry**: where a host emits structured retry or fallback events
  (for example can1357/oh-my-pi#11678, if it lands), record them as
  `host-override` evidence with the host's own words. Do not infer host
  behaviour Sabi did not observe.

## Acceptance

- A round served as planned has a receipt with no `reason`.
- The spec 020 fixture produces `reason: 'refusal'` (or `'fallback'` before
  020 lands) with `requested.tier: cheap`, `effective.tier: strong`.
- A response whose model field is missing gives `effective.observed: false`.
- Dashboard and replay tests cover one matched and one mismatched round.

## Out of scope

- Cost savings claims. Receipts are the evidence a savings claim needs; the
  claim itself belongs to the evals (#89).
