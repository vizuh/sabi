# Prime Agent patterns worth reusing

Read-only assessment, 2026-09-18. Recommendation: borrow the patterns, not the Python
kernel or a second agent loop. Command Code remains Sabi's first host.

## Installed evidence

Inspected release: `~/.local/share/prime-agent/releases/0.9.5-linux-x64-bc4b0ed791d1e8b3b5d6a95249a60306d9579fc0d6038e5d7d82f068d81f008d/`.
`package.json` reports **0.9.5**. `.archive-sha256` records the suffix above; the archive
itself was not downloaded or rehashed. Paths below are relative to that release.
`prime-agent-runtime/src/rlm/__init__.py` SHA-256:
`56f33f00ec715c45ac7babdd806e01e20940859ba644fd8377e00d3da8ea9287`.
Parent review checked the cited source and docs after the delegated first pass.
No credentials, account settings or raw session logs were inspected.

## Verified patterns and Sabi fit

| Prime evidence | Recommendation for Sabi on Command Code |
|---|---|
| Persistent Python programming state; host owns child execution, accounting and lifecycle (`docs/rlm-runtime.md:3,62-86`) | **Adopt the separation now.** Keep small typed routing state in Command Code `modState`. No embedded Python kernel needed. |
| `spawn` returns an admission handle; child results arrive separately (`rlm/__init__.py:161-184`, `docs/rlm-runtime.md:23-30`) | **Reuse native background jobs.** Command Code already supplies background `agent` and shell jobs. Sabi should account for them, not add another worker framework. |
| `collect(timeout_ms=0)` is a nonblocking snapshot (`rlm/__init__.py:390-407`) | **Adopt event-driven observation.** Do not spend inference rounds repeatedly polling unfinished work. Completed artifacts still need parent verification. |
| Throttled `progress_note` (`rlm/__init__.py:430-450`) | **Adopt visible milestones now.** Show what changed, current routing reason, unknowns and next check. Keep a headless-safe record as well as optional UI status. |
| Local/global harness state (`rlm/harness.py:923-940`) and ranked lookup (`rlm/harness.py:904-906`) | **Adapt narrowly.** Session-local evidence references and policy state first. Cross-project memory and automatic learning come later, with provenance and review. |
| Host compaction; `compact.run` schedules it after the turn (`skills/compact/src/compact/__init__.py:1-5,25-39`) | **Coordinate with the host.** Command Code already compacts; Sabi can project relevant evidence after that. Do not port Prime's compactor or run two independent summarizers. |

In the table, `rlm/` abbreviates `prime-agent-runtime/src/rlm/`.
The scheduling statement describes the explicit `compact.run` wrapper, not proof
that every Prime auto-compaction path runs at the same point. `docs/compaction.md:29-45`
describes thresholds, retained recent context and appended summary entries.

## Later, only with measured benefit

- Bounded independent review of risky changes: read-only worker, explicit budget,
  acceptance check and cancellation. Include review cost in completed-task metrics.
- Learned model profiles: separate task/repository outcomes from transient state;
  evaluate on held-out tasks before changing routing policy.
- Durable evidence cache: source revision, span, trust and freshness. Never silently
  promote a tool result or generated summary into user instructions.

## Do not copy

- The persistent Python runtime, recursive-agent control plane or broad self-editing
  harness store into Sabi. They add scope and maintenance without proving routing gains.
- The assumption that delegation equals per-round scheduling. Prime's verified
  `spawn(model=..., thinking=...)` selects a **child**. It does not prove a supported
  extension can replace the model for the next round of an existing parent trajectory.
- Automatic forced continuation until a model says work is complete. Real test outcomes,
  permission boundaries, budget limits and user stops take precedence.

## Next agent's acceptance check

Use [Command Code's verified hooks](command-code-roadmap.md) and the
[folder review](folder-review.md). Build an offline lifecycle fixture with two user
runs, a background job, compaction, resume and a missing usage event. Routing state
must remain attributable and serializable; Sabi must not create another execution
loop, duplicate compaction or poll with extra model calls. A Prime adapter contract
remains **unverified** and is not a prerequisite for this work.
