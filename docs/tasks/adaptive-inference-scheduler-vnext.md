# Adaptive inference scheduler VNext tasks

Tasks are ordered by dependency. Each lane can be delegated only after its acceptance gate is
explicit; no task may silently turn an unknown into a success, price or entitlement.

## Evidence and state — adapter/core agent

- [x] Command Code writes normalized round receipts beside the harness workspace.
- [x] Preserve legacy custom entries and omit the first host-served unplanned round.
- [x] Hash tool identities consistently with the proxy; omit raw tool data and unknown prices.
- [ ] Add explicit evidence provenance (`observed`, `verified`, `unverified`, `contradicted`).
- [ ] Add verification status and requested-scope coverage to trajectory state.
- [ ] Make compaction/handoff preserve provenance without upgrading its status.

## Judge and recovery — deterministic/recovery agent

- [ ] Replace last-excerpt judge input with bounded state-conditioned evidence slots.
- [ ] Add typed recovery actions before tier/model selection.
- [ ] Add recovery capsules for controller `SPAWN`.
- [ ] Separate observed recovery from matched and replay-validated recovery.
- [ ] Add PRE/LIVE/POST failure detector eval cases.

## Candidate routing — catalog/adapter agent

- [ ] Normalize native free-model catalogs without treating presence as entitlement.
- [ ] Filter candidates by tools, modalities, context, structured output and effort.
- [ ] Add quality/latency/cost dimensions with unknown-safe scoring.
- [ ] Add same-tier fallback for provider/transport failures; do not escalate reasoning tier.
- [ ] Keep Pi inventory/probe-only until its installed session contract has a receipt-backed adapter.

## Learning and evaluation — evals agent

- [ ] Record semantic operations and cost/failure aggregates.
- [ ] Add a calibrated development subset plus a held-out set for router changes.
- [ ] Backtest candidate policies before shadow activation.
- [ ] Promote learned profiles only after deterministic gates and preserve rollback metadata.
- [ ] Add recurring-operation fast paths only after sufficient local evidence.

## Operations — controller/release agent

- [ ] Bound log rotation, replay memory and per-session caches for 10x synthetic load.
- [ ] Expose receipts and unknowns in a read-only report/dashboard.
- [ ] Add live free-runtime receipts only with pinned versions and no paid fallback.
- [ ] Keep source, tests, PR/CI, deployment and observed runtime evidence separate.
