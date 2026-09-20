# Surplus inference and shadow QA tasks

## First slice

- [x] Inventory fixed zero-cost aliases without treating adaptive aliases as free.
- [x] Build a bounded diff packet with secret-path and secret-marker refusal.
- [x] Send one read-only review through the local `sabi-quality` proxy alias.
- [x] Parse structured claims without treating them as verified findings.
- [x] Persist metadata-only receipts and retain rate-limit/no-fallback evidence.
- [x] Add offline tests for resource filtering, packet boundaries, response parsing and receipts.

## Evidence gates

- [ ] Run a bounded live shadow review on an approved public or synthetic repository; record the
      proxy receipt separately from model quality.
- [ ] Add deterministic claim verifiers for tests, type errors, file/line existence and API schemas.
- [ ] Add a privacy-approved completed-task set and held-out comparison before quality/savings claims.
- [ ] Fan out to multiple current free resources only when each has a fixed alias and independent
      receipt; no implicit paid fallback.
- [ ] Let Jev choose review intent only after deterministic packet safety and resource gates pass.
- [ ] Keep model × intent history shadow-only until replay, sample thresholds, confidence bounds and
      rollback metadata exist.
- [ ] Add advisory handoff to the primary agent only after an independently verified claim.
