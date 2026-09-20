# Adaptive inference scheduler VNext

Status: planned; first evidence slice implemented in `command-code-evidence-parity`.

This is the Sabi feature spec, expressed as the project's short-form Spec Kit
spec/plan artifact. It keeps the harness loop native and turns research ideas
into testable seams before adding learned routing.

## Problem

Sabi currently makes a strong trajectory decision (`round state -> rule -> tier`) but its
adapter evidence is fragmented and its tier still has too much responsibility. The target is:

```text
trajectory -> structured evidence -> intervention -> candidate model/harness
           -> receipt + verification -> validated episode -> shadow policy update
```

OrcaRouter Lite is a useful gateway reference for capability filtering, candidate ranking,
fallback chains, caching and analytics. AgentRun/Pi is a useful harness reference for separating
decision from action, typed state, bounded workflows, traces, receipts, replay and promotion
gates. Sabi must borrow those boundaries without becoming a generic gateway or copying external
code, prompts, claims or provider entitlements.

## Requirements

1. Every supported adapter emits one privacy-safe normalized receipt in the common core log, with
   explicit unknowns for missing session, usage, price, latency and outcome evidence.
2. Deterministic capability and transport gates run before optional Jev or learned decisions.
3. A route selects an intervention (`continue`, `retry`, `gather-evidence`, `repair`, `escalate`,
   `fresh-context`, `rollback-with-reflection` or `ask`) before selecting a model candidate.
4. Candidate selection filters hard requirements first, then scores verified task evidence, latency
   and cost only where prices are actually known. Catalog presence is never entitlement proof.
5. Recovery credit is graded: observed adjacency is weaker than matched evidence, which is weaker
   than replay from a captured clean state.
6. Verification status, evidence provenance and requested-scope coverage survive compaction and
   handoff; summaries cannot promote unverified claims to verified facts.
7. Learned policy changes remain shadow-only until deterministic backtest, held-out evaluation and
   rollback metadata approve promotion.
8. Each step has bounded context, tool/schema membership, budget and retry/timeout behavior; an
   unknown external action is reconciled before retry.

## Acceptance gates

- focused unit tests cover each new state transition and privacy boundary;
- deterministic evals cover PRE/LIVE/POST failure detection, verification gaps, coverage gaps,
  transport failure, compaction, replay and held-out promotion;
- adapter receipts can be joined without raw prompts, tool arguments or secrets;
- a 10x synthetic trace run shows bounded memory/log writes and no unbounded per-session cache;
- no cost/savings claim is emitted when provider price or measured usage is absent;
- live provider/harness claims require a pinned runtime, exact receipt and an explicitly approved
  free/paid boundary.

## Non-goals

- replacing Command Code, OpenCode, Claude Code, Codex or Pi loops;
- cloning OrcaRouter Lite's dashboard, gateway protocols or hosted fallback;
- defaulting every route to Jev;
- reinforcement learning, fine-tuning or automatic policy promotion in the first release;
- claiming universal model quality from local observations.

## Phased plan

1. Evidence parity: common adapter receipts, provenance-safe state, usage validation. *(current)*
2. Verification/provenance: verification status, evidence slots, coverage and compaction-safe
   handoffs.
3. Recovery: typed intervention actions, recovery capsules and observed/matched/replayed evidence.
4. Candidate substrate: normalized catalog, capability filter, same-tier fallback and verified
   quality/latency/cost dimensions.
5. Evaluation: semantic operation profiler, selected development subsets, held-out promotion and
   replay reports.
6. Learning: shadow behavioral profiles and recurring-operation fast paths, promoted only through
   the gates above.

The smallest next slice after evidence parity is verification/provenance. It improves the data
quality needed by every later phase without making routing less deterministic.
