# Requirements Quality Checklist: Evidence-Aware Adaptive Scheduler

**Purpose**: Unit tests for the written requirements, not implementation QA.
**Audience**: Sabi maintainers and PR reviewers.
**Status**: Reviewed 2026-09-20

## Completeness

- [X] CHK001 The specification defines primary, alternate, exception, recovery, and non-functional scenarios. [Completeness]
- [X] CHK002 Verification, provenance, coverage, recovery, controller, profiling, and eval concerns each have explicit requirements. [Completeness]
- [X] CHK003 Out-of-scope boundaries exclude RL, live replay, automatic promotion, and unsupported adapters. [Completeness]

## Clarity and consistency

- [X] CHK004 The terms observed, matched, replayed, verified, unverified, and unknown have distinct meanings. [Clarity]
- [X] CHK005 The spec distinguishes a model/harness route from a recovery action. [Consistency]
- [X] CHK006 The spec distinguishes verification state from verification round classification. [Consistency]
- [X] CHK007 The spec distinguishes source/tests, offline fixtures, CI, live runtime, and human acceptance. [Clarity]

## Acceptance criteria quality

- [X] CHK008 Success criteria include deterministic behavior, bounded payloads, privacy, regression, and 10x performance measurement. [Measurability]
- [X] CHK009 No success criterion claims universal quality, savings, or latency from the supplied papers or offline fixtures. [Measurability]
- [X] CHK010 Each P1 story has an independent test and at least two acceptance scenarios. [Traceability]

## Edge-case and recovery coverage

- [X] CHK011 The requirements address stale compaction generations, duplicate delivery, malformed receipts, and restart boundaries. [Edge Case]
- [X] CHK012 The requirements address quota, timeout, denial, unsupported modality, invalid judge action, and exhausted routes. [Edge Case]
- [X] CHK013 The requirements address destructive or unavailable replay and state-fingerprint collision. [Recovery]
- [X] CHK014 The requirements address cold-start models, provider changes, insufficient samples, and mixed task semantics. [Coverage]

## Dependencies and assumptions

- [X] CHK015 Existing Sabi contracts and current configuration bounds are named as dependencies. [Dependency]
- [X] CHK016 External paper claims are explicitly labelled as supplied, not as independently verified Sabi evidence. [Assumption]
- [X] CHK017 Provider credentials, live quotas, and cross-harness availability are explicitly out of scope for local acceptance. [Boundary]

## Convergence findings

- [X] CHK018 The controller judge-boundary task points to `jev.ts`, where the
  bounded state is actually constructed; deterministic `decide.ts` remains a
  separate no-side-effect gate. [Consistency]
- [X] CHK019 The implementation keeps semantic profiles, replay, and calibrated
  subsets out of active routing; live provider quality and savings remain
  unverified. [Boundary]
