# Contract: Evaluation Episode and Profile Candidate

## Episode fields

Every fixture episode records:

- `phase`: `pre`, `live`, or `post` failure-detection information state;
- `operation`: normalized semantic operation label;
- `route`: model, harness, provider, effort, and capability gate outcome;
- `result`: recovered, failed, incomplete, or unknown;
- `verification`: status plus receipt presence;
- `coverage`: expected/observed/source when available;
- `recovery`: action and evidence grade when applicable;
- `usage`: measured tokens/cost/latency when available, otherwise unknown;
- `evidence`: fixture, source-test, CI, or live-runtime provenance.

## Candidate lifecycle

```text
shadow -> backtested -> gated-active
   └──────────────> rejected
gated-active -> rolled-back
```

Promotion requires a reproducible subset, held-out comparison, minimum sample
threshold, no hard-gate regression, explicit rollback reference, and a report
that separates measured usage from estimates. A candidate in `shadow` or
`backtested` cannot alter active routing.

## Required report boundaries

Reports must show sample count and confidence/uncertainty, keep evidence grades
separate, distinguish unknown from zero, and label offline fixture results. A
small eval subset is not a universal benchmark and cannot support a product
quality, savings, or latency claim by itself.
