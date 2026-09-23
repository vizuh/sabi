# Submission: Awesome Jev Projects

Sabi's entry for the [Awesome Jev Projects](https://github.com/logicrw/awesome-jev-projects)
directory. Every claim below was verified against the pinned commit, not against `main`, so a
source reviewer can check exactly what was claimed.

- **Repository:** https://github.com/vizuh/sabi (public, non-fork, MIT — `LICENSE` at the root)
- **Pinned commit:** `7f626c392f799f84121a5abae2e0eb9dd56028ce` (2026-09-21, an ancestor of `main`)
- **Form:** `.github/ISSUE_TEMPLATE/project.yml` in the directory repo
- **Submitted:** [issue #74](https://github.com/logicrw/awesome-jev-projects/issues/74), 2026-09-23
- **Outcome:** accepted and closed the same day — "项目已通过 Jev 源码集成检查" (passed the Jev
  source integration check) — and published to the catalog as `vizuh:sabi`

## Catalog entry

`https://logicrw.github.io/awesome-jev-projects/projects.json` → `id: "vizuh:sabi"`, category
`Routing & Cost Optimization`, tags `llm-routing-cost`, `coding-agents`, `typed-decisions`.

The directory ran its own source review rather than trusting the links above: it resolved the
repository's `main` HEAD at review time (`208ee753f7598514d0de2ec8966d31b70766bc01`) and pinned
evidence to that commit, listing ten files — including `packages/core/src/jevPrReview.ts`,
`packages/controller/src/agents.ts`, `model-health.ts` and `service.ts`, which this submission never
cited. Its own discovery found more Jev integration surface than the submission claimed.

## Form fields

| Field | Value |
| --- | --- |
| Title | `[Project]: Sabi` |
| Category | `Routing & Cost Optimization (模型路由与成本优化)` |
| Tags | `llm-routing-cost`, `coding-agents`, `typed-decisions` |
| Primitives | ⚡ Choice, 🛡️ Noul — **not** Score |

## Where Jev makes a decision

Sabi keeps a deterministic trajectory policy as the base layer and uses Jev as a bounded semantic
decision layer over the states that policy cannot settle. `sabi.config.json` scopes Jev to those
states only: `judge.callOn: ["failure", "unclassified"]`.

### 1. Escalation judge — Noul + Choice

The TypeSafe client posts `{ state, model, questions }` to `/systemone` and validates the answer
shapes: a `noul` for whether a failure is a real problem, a `choice` for task difficulty.

- https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/server/src/typesafe.ts#L84-L116

The typed result is applied to the routing decision — veto a deterministic escalation, confirm it,
or leave it to the deterministic policy in the ambiguous band:

- https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/core/src/judge.ts#L363-L374
- difficulty Choice re-tiers an unclassified round:
  https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/core/src/judge.ts#L410-L419

### 2. Controller action routing — Choice over a closed set

When more than one safe controller action is available, Jev chooses from a code-generated set
(`CONTINUE`, `DELEGATE`, `SPAWN`, `ORCHESTRATE`, `ASK`). An answer outside that set is refused and
the deterministic fallback is used:

- https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/controller/src/jev.ts#L90-L138
- the closed set and its descriptions:
  https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/controller/src/jev.ts#L18-L24

## Verification

Tests showing a low real-problem probability vetoes an unnecessary strong-tier escalation, and that
a confident difficulty Choice re-tiers an unclassified round:

- https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/core/test/judge.test.ts#L118-L133
- https://github.com/vizuh/sabi/blob/7f626c392f799f84121a5abae2e0eb9dd56028ce/packages/core/test/judge.test.ts#L275-L292

## What this evidence does not claim

The directory's own framing applies: a source check is not a security, performance or production
review. These links prove that Sabi calls Jev and acts on typed answers. They do not prove model
quality, savings, latency or entitlement, and the repository states the same boundary in
`README.md` and `docs/handoff.md`.

## Correction applied to the first draft

The initial draft linked `packages/core/src/judge.ts#L285-L380`. That range starts at `applyJudge`
but ends inside the ambiguous-band branch, 42 lines before the function ends, so it did **not**
contain the difficulty re-tier it was cited for. Replaced with the two exact branch ranges above.
The test range was corrected from `#L275-L294` to `#L275-L292` (294 was the next test's opening).
