# Contract: Core Evidence and Recovery

## Inputs

Core receives existing `TrajectoryState`, round metadata, allowlisted
`EvidenceCode` values, optional tool/harness receipts, and configured bounds.
Unknown or malformed fields are treated as unknown; raw excerpts are not
required inputs.

## Outputs

The core decision path may return:

- additive `verification`, `coverage`, `evidence`, and `contextGeneration`
  fields;
- one `RecoveryAction` and a reason code;
- a bounded `JudgeEvidence` object when a judge is eligible;
- a `RecoveryObservation` with one evidence grade when an episode closes.

## Invariants

1. Hard failure, transport, denial, capability, and invalid-receipt gates run
   before judge or learned-candidate logic.
2. `passed` or `failed` verification requires explicit evidence for the current
   context generation.
3. `observed`, `matched`, and `replayed` are never collapsed into one rate.
4. All lists, strings, and serialized payloads are bounded by existing config
   limits or the feature's explicit constants.
5. Identical inputs produce identical outputs; timestamps and random IDs are not
   part of pure planner decisions.
6. Omitted optional fields preserve legacy readers and legacy behavior.

## Failure contract

If evidence is missing or a receipt is unverifiable, the result is `unknown` and
the host task remains intact. Sabi may ask for evidence or the user, but may not
claim task success or silently promote a route.
