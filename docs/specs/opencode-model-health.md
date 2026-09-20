# OpenCode model health V1

Status: complete for the local controller-selection slice, 2026-09-20.

## Contract

1. A configured OpenCode preference is matched against the live local catalog and worker-only
   model IDs; catalog presence remains evidence, not plan entitlement.
2. A controller execution receipt records the selected harness/model, observed receipt latency and
   outcome. This latency is controller-observed completion/receipt time, not first-token time.
3. A failed model is temporarily unavailable for the process-local health window, so the next
   configured catalog model can be selected on a fresh inventory snapshot.
4. If every configured model is temporarily unavailable, selection returns to the first valid
   catalog model. This is fail-open and does not invent a healthy or free claim.
5. `started` and `completed` receipts are successful availability observations; `unverifiable`
   remains unknown and never becomes a success or failure.

## Non-goals

- no automatic paid-provider probe or model request;
- no subscription/entitlement inference from a catalog;
- no first-token claim until the host exposes that timestamp;
- no durable learned policy or economic optimization in this slice.

The next live gate is a bounded free OpenCode receipt, an unknown/paid receipt, an explicit quota
failure and a fallback, with runtime versions and spend boundaries recorded separately.
