# Surplus council and execution ledger

Status: contract and metadata ledger only. The current release does not
automatically convene a council, change the primary task, or promote a model
finding to truth.

## Purpose

Sabi may spend otherwise-available inference on bounded, read-only review of a
primary result. JEV chooses whether the extra work is worth doing and which
uncertainty to attack. The reviewers supply independent claims; deterministic
checks decide whether a claim is supported.

```text
primary result
    -> safe egress packet
    -> JEV review plan
    -> none | probe | panel | debate | council
    -> independent seats
    -> optional cross-examination
    -> synthesis
    -> deterministic verification
    -> metadata receipt and learned evidence
```

## Modes and budgets

| Mode | Calls | Use |
| --- | ---: | --- |
| `none` | 0 | no material uncertainty or no safe surplus resource |
| `probe` | 1 | one bounded second opinion |
| `panel` | 2–3 | independent questions with different failure modes |
| `debate` | 2–3 + response | claims conflict and a response may resolve it |
| `council` | 3–5 + synthesis | high-consequence or multi-risk work |

The first slice is shadow-only. It never uses paid fallback, tools, credentials,
or model self-confidence as verification. A budget is a ceiling, not a target.

## Seat protocol

Each seat receives the same approved task boundary but a distinct question. The
first pass is blind: it does not receive the primary model's opinion or another
seat's answer. Seat diversity means different capabilities and, when the live
inventory supports it, different provider/model families and harnesses.

Examples:

- control-flow adversary: trace state transitions and identify one unsafe path;
- contract critic: check API, schema, and type boundaries;
- test-gap hunter: name one changed behavior without a meaningful test;
- design critic: inspect visual evidence without changing files.

Cross-examination is allowed only after a bounded conflict or material claim.
It receives anonymized claims, asks each seat to attack the evidence rather than
vote for a model, and records disagreement. A synthesizer that did not take
part in the first pass is preferred; if that is impossible, the receipt says
that independence was reduced.

## Evidence boundary

External free resources receive only a safe packet: tracked diff or bounded
artifact, approved relative paths, and the single review question. Secret-like
paths, credential markers, environment values, terminal handles, tool grants,
and raw conversation history are refused. Local resources may have a broader
policy, but that policy is explicit and does not silently apply to external
free resources.

Model confidence is not evidence. A claim becomes actionable only after an
independent verifier can reproduce it, for example a failing test, type error,
existing file/line, or schema mismatch. Until then `verifiedClaimCount` remains
zero and the result is advisory.

## Ledger contract

`packages/core/src/council.ts` defines `CouncilPlan` and an append-only JSONL
`CouncilLedgerReceipt`. Each receipt records only:

- harness, runtime version, provider, model, seat, stage, mode, intent, and
  source;
- status and evidence level (`none`, `transport`, `execution`, `completion`,
  or `verification`);
- opaque input/output hashes, bounded counts, latency, token counts when
  measured, HTTP status, and a short error code.

It never stores prompts, diffs, claims, provider responses, secrets, or raw
transcripts. The default path is the user's Sabi config directory and can be
overridden with `SABI_COUNCIL_LOG`.

```bash
sabi council history --last=20
sabi council record --harness=opencode --runtime-version=1.18.31 \
  --provider=openrouter \
  --model=provider/model:free --stage=review --mode=probe \
  --intent=api-contract --status=completed --evidence=execution \
  --source=live
```

`record` records provenance; it does not execute a model call. An adapter must
write a receipt only after its own bounded call and must label transport-only,
execution, completion, and verification separately.

## Promotion gates

The following are deliberately not part of this slice:

1. a Jev-backed plan selector;
2. OpenCode and Hermes council adapters with completion receipts;
3. deterministic claim verifiers and a privacy-approved task corpus;
4. conflict-driven debate and a separate synthesizer;
5. replay, held-out evaluation, model × intent precision, and policy promotion.

No council output may alter the primary task until those gates are met.
