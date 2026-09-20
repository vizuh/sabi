# OpenCode model health V1 tasks

- [x] Keep catalog parsing and worker/Jev filtering deterministic.
- [x] Record selected model, receipt latency and outcome in controller execution evidence.
- [x] Demote a failed model for the bounded process-local health window.
- [x] Select the next configured catalog model after a failed model.
- [x] Fail open to the first valid model when all configured candidates are unavailable.
- [x] Keep unverifiable receipts unknown.
- [x] Add focused health and inventory tests.
- [x] Document that latency is receipt-observed, not first-token latency.

## Deferred gate

- [ ] Run bounded live OpenCode free, unknown/paid, quota-failure and fallback receipts with
      pinned runtime evidence; do not infer entitlement from catalog labels.
- [ ] Add durable health/receipt storage only after the daemon needs cross-process recovery.
