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

One optional object per record, `route` (the name `receipt` is taken by core's
`ExecutionReceipt`):

```ts
route?: {
  requested: { tier: string; model: string; effort?: string }
  effective: { tier: string; model: string; observed: boolean }
  reason?: 'fallback' | 'substituted'
}
```

- `requested` is Sabi's decision after the judge and the dispatch gate, before
  any upstream call. A fallback rewrites `record.tier`, so without this the
  planned tier is lost; the dashboard used to print "planned X failed · served
  by X" for that reason.
- `requested.effort` copies the client-requested `record.effort`; its meaning
  is unchanged (#146, #147).
- `effective` is what served. `observed: true` only when the response named a
  configured model; otherwise `model` is the tier's configured model. There is
  no effective effort: no upstream Sabi talks to reports one. Add it when one
  does.
- `reason` is present only when the two differ: `fallback` (the planned call
  failed or was skipped, and the next tier served) or `substituted` (the
  upstream served a different configured model). Why the planned upstream
  refused is `upstreamRefusal` (spec 020), not a second reason. The list is
  closed; a new reason needs a spec change. `explicit-route`, `clamp` and
  `host-override` from the draft are not built: nothing produces them yet.
- Written only on rounds that served. Existing fields are unchanged.

## Surfaces

- **Dashboard**: the timeline and the rounds table show
  `planned → served (refusal label)` from the receipt. The existing
  "recovered by fallback" count already is the mismatch count; no new KPI.
- **`npm run report`**: `routeMismatches` and `byRefusal` counts.
- **Host telemetry** (for example can1357/oh-my-pi#11678, if it lands): not
  built. Trigger: a host that emits structured retry or fallback events.

## Acceptance

- A round served as planned has a receipt with no `reason`.
- The spec 020 fallback fixtures produce `reason: 'fallback'` with the planned
  tier in `requested` and the serving tier in `effective`.
- Dashboard and report tests cover a mismatched round.

## Out of scope

- Cost savings claims. Receipts are the evidence a savings claim needs; the
  claim itself belongs to the evals (#89).
