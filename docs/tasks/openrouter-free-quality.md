# OpenRouter free quality lane tasks

## Shipped

- [x] Discover the current OpenRouter catalog during explicit setup.
- [x] Gate candidates on exact zero prompt/completion pricing, text I/O, tools and output limits.
- [x] Select deterministically from generic metadata without model-name affinity.
- [x] Write `quality`, `sabi-quality` and `verification -> quality` with catalog provenance.
- [x] Preserve paid tiers and prevent free-only Command Code registration from exposing an adaptive
      alias that can reach paid branches.
- [x] Back up config once and fail before writing on missing credentials, catalog errors or invalid
      candidates.
- [x] Add offline selection, config patch, secret-safety and adapter-registration tests.

## Next evidence gates

- [x] Run a bounded, read-only comparison of two or more current free candidates on a fixed synthetic
      QA set; record status, latency and parse/receipt success separately from quality. The
      2026-09-20 run covered four candidates and 12 rounds; details are in the handoff/log.
- [ ] Add a user-approved, privacy-safe completed-task set before claiming quality or savings.
- [ ] Add receipt-aware health/demotion for the OpenRouter quality lane; a 429 must not become a task
      failure or silently spend on a paid tier.
- [ ] Add debate/evaluator orchestration only after the single-lane contract has live receipts.
- [ ] Keep learned profiles shadow-only until replay, held-out evaluation and rollback metadata exist.
