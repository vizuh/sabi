# Command Code evidence parity V1

Status: planned for the first adapter slice.

## Contract

1. A Command Code round that was actually served by a Sabi plan writes one normalized
   `DecisionRecord` to `<harness cwd>/.sabi/decisions.jsonl`, using the existing core log schema.
2. The first host-served round is not represented as a Sabi decision because no plan existed yet.
   The existing `sabi/decision` custom entry remains for compatibility.
3. Session identity is opaque and marked `sessionKnown: false` because the current host contract
   exposes no real session ID. Tool names use the same stable hash as the proxy; raw tool output,
   arguments and prompts are never written.
4. Valid measured input/output usage is preserved as token totals. Missing or invalid usage stays
   absent. Harness subscription catalog entries do not imply a price, so `cost` stays absent.
5. A log write is fail-open: a read-only/full workspace must not break the host's agent loop.

## Non-goals

- no Jev call from the mod;
- no dynamic model catalog or same-tier fallback;
- no provider/cost inference from a harness subscription;
- no claim that a completed round means the whole task succeeded;
- no change to the host harness loop or existing custom-entry consumers.

## Follow-ups

Use this evidence as the input for Jev shadow evaluation, validated recovery episodes, semantic
operation profiling, and catalog-aware candidate selection. Promote those only after replayable
tests and bounded receipts exist.
