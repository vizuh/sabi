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

- [x] Run a bounded live OpenCode free receipt with pinned runtime evidence. This proves the native
      free-model/plugin path and a safe `CONTINUE`, but not a controller-spawned model-health
      receipt.
- [ ] Observe an unknown/paid receipt only with explicit approved spend and runtime evidence; do
      not infer entitlement from catalog labels.
- [ ] Observe a quota failure and successful fallback on an addressable controller target without
      retrying after an accepted/started receipt.
- [ ] Add durable health/receipt storage only after the daemon needs cross-process recovery.
