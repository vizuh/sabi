<!--
Sync Impact Report
- Version: template -> 1.0.0
- Modified principles: none; established five project principles.
- Added sections: Evidence and privacy constraints; Delivery workflow.
- Removed sections: template placeholders only.
- Templates requiring updates: plan/spec/tasks remain structurally compatible; feature plan is the source of truth.
- Follow-up TODOs: none.
-->

# Sabi Constitution

## Core Principles

### I. Native Harness, Bounded Scheduler

Sabi MUST schedule inference and controller actions through the host harness's
supported extension surface. It MUST NOT fork, patch, or silently replace the
harness loop. Every decision MUST be bounded by explicit capability, context,
modality, provider, and retry constraints.

### II. Evidence Before Adaptation

Sabi MUST distinguish observed, inferred, verified, contradicted, and unknown
facts. A temporal success after a failure is observational evidence only; replay
or matched-state evidence MAY increase confidence but MUST remain separately
graded. Logs MUST NOT promote routing rules directly from unvalidated outcomes.

### III. Deterministic Safety Gates

Hard failures, transport limits, user denial, unsupported tools or modalities,
missing verification, and insufficient scope coverage MUST have deterministic
handling. A judge MAY choose only code-generated valid actions. Fail-open
behavior MUST preserve the host task and MUST never claim completion without an
explicit receipt or verification result.

### IV. Testable Contracts and Receipts

Every new state, recovery action, evidence grade, and controller handoff MUST
have a typed contract and focused runnable tests. Execution acceptance MUST be
based on structured receipts, not input acceptance, a printed plan, or a worker's
self-report. Offline fixtures, source tests, CI, live runtime, and human
acceptance MUST remain separate evidence layers.

### V. Privacy, Simplicity, and Reversibility

Sabi MUST store bounded allowlisted evidence by default, never secrets or raw
provider credentials, and MUST avoid transcript retention unless explicitly
enabled. New learning behavior MUST begin in shadow mode with rollback and a
smallest-sufficient implementation. Complexity MUST be justified by a measured
failure mode or a documented upgrade trigger.

## Evidence and Performance Constraints

- Evidence records MUST be bounded in size and carry source, status, and context
  generation where applicable.
- Verification, coverage, and recovery state MUST remain useful after compaction
  and cross-harness handoff.
- The default routing path MUST remain deterministic and avoid judge calls when
  hard evidence already decides the action.
- Performance claims MUST be measured against matched fixtures or live receipts;
  offline repricing is not a product benchmark.
- User data, prompts, raw tool output, provider keys, and usage logs MUST NOT be
  added to Git unless explicitly sanitized and in scope.

## Development Workflow

1. Specify user-visible behavior, edge cases, measurable outcomes, and explicit
   non-goals before implementation.
2. Design typed state and contracts before routing or learning logic.
3. Add focused regression tests for every non-trivial branch and preserve the
   existing full suite.
4. Keep learned profiles and utility scoring in shadow/backtest gates until
   comparable outcome data and rollback criteria exist.
5. Report local tests, remote CI, deployment, live runtime, and acceptance as
   separate facts.

## Governance

This constitution governs the Sabi vNext feature artifacts and implementation.
An amendment MUST record the version bump, affected principles, compatibility
impact, migration or rollback plan, and validation evidence. A pull request MUST
include the relevant spec/task traceability and MUST NOT use a benchmark or
research claim as a substitute for repository or runtime evidence. If a
requirement is materially unclear, record `NEEDS CLARIFICATION` rather than
inventing a provider, capability, price, or success metric.

**Version**: 1.0.0 | **Ratified**: 2026-09-20 | **Last Amended**: 2026-09-20
