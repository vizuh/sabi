# Surplus council tasks

## Phase 0 — contract and evidence ledger

- [x] Define `none`, `probe`, `panel`, `debate`, and `council` modes.
- [x] Define blind seats, optional cross-examination, synthesizer, and evidence
      levels.
- [x] Add append-only metadata receipts for harness/provider/model provenance.
- [x] Add `sabi council history|record` without executing a provider call.
- [x] Keep raw prompts, diffs, claims, responses, credentials, and transcripts
      out of the ledger.

## Phase 1 — safe planning

- [x] Add deterministic pre-gates for sensitive paths, public/synthetic scope,
      available resource, and per-request call budget (`councilPreGate`).
- [x] Add a JEV plan schema that returns mode, intent, seat objectives, and an
      explicit `none`/`unsure` path. JEV must not execute the next action
      (`CouncilPlan` with `reason` union including `unsure`; no execution).
- [x] Add a plan receipt before any seat starts; record the actual plan and the inventory
      snapshot hash, not a mutable catalog claim.

## Phase 2 — harness adapters

- [ ] Run a read-only OpenCode seat through its supported integration surface;
      record runtime version, provider/model, transport and completion receipts.
- [ ] Run a read-only Hermes seat through its supported integration surface;
      record runtime version, provider/model, transport and completion receipts.
- [ ] Keep OpenCode and Hermes as peer adapters; no shared lifecycle assumption
      and no claim of in-session model switching without a runtime receipt.
- [ ] Use fresh bounded sessions for surplus seats until model-switch behavior
      is proven safe in an existing session.

## Phase 3 — evidence and debate

- [ ] Add deterministic verifiers for tests, type errors, file/line existence,
      and API/schema contracts.
- [ ] Fan out only when seats have distinct objectives and independent resource
      evidence; duplicate calls do not count as diversity.
- [ ] Start cross-examination only for a bounded material conflict; anonymize
      first-pass positions and preserve dissent.
- [ ] Prefer a synthesizer outside the panel; record reduced independence when
      the same model/provider must synthesize.

## Phase 4 — learning and promotion

- [ ] Store model × harness × intent outcomes as metadata with provenance and
      sample counts; never rank from one run or self-reported confidence.
- [ ] Replay against a privacy-approved completed-task set and a held-out set.
- [ ] Promote only independently verified findings to advisory handoff.
- [ ] Keep rollback, rate limits, and a kill switch for each promoted policy.

## Stop conditions

- No safe packet, usable zero-cost resource, or bounded budget: `none`.
- Provider/harness transport succeeds but task completion is unknown:
  `transport`, not `completion`.
- A claim is plausible but not independently reproduced: `verifiedClaimCount=0`.
- A reviewer fails or times out: record it and fail open; do not retry outside
  the request budget or fall back to paid inference.
