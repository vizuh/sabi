# Sabi

Adaptive inference scheduling for AI agents.

Sabi sits between a coding harness and its model providers. The harness keeps its normal agent loop; Sabi decides which model, reasoning effort, and provider serves each inference round — continuously, across the whole trajectory, not just the first prompt.

## Why

A coding task is not one request. It is many rounds: search, read, trace, edit, test, retry, synthesize. Paying the frontier model for every round wastes money; paying the cheapest model for every round breaks the hard steps (failing tests, architecture, security).

Existing routers classify a single prompt, apply static rules, or delegate phases to subagents. Sabi's unit of decision is the state of an agent trajectory.

Planned inputs per round:

- **trajectory state** — round position, tool results, test pass/fail, diffs, context growth, uncertainty
- **model profiles** — historical outcomes by repo, task and round kind
- **live economics** — quota, rate limits, latency, cost

Output: model × effort × provider for the next round, escalating or downgrading as the trajectory evolves.

From the harness's point of view nothing changes:

    /model
      └── Sabi
          └── sabi-code     # one synthetic model; Sabi decides what serves it

## Status

Bootstrap (2026-09-18). Docs, decisions and prior-art research only — no runtime code yet.

## Planned layout

    packages/
      core/          trajectory state, routing policy, model profiles, economics, learning
      judges/jev/    semantic judgments (Jev)
      evals/         benchmarks, baselines, evaluation harness
      adapters/
        command-code/
        prime-agent/
        opencode/

## Prior art

[docs/research/github-landscape.md](docs/research/github-landscape.md) — verified survey (2026-09-18) of the closest projects and the gap Sabi targets.

## Naming

Product name: **Sabi**. GitHub handles `sabi`, `uasabi` and `sabido` were taken, so the repo lives under the Vizuh namespace: https://github.com/vizuh/sabi (private). Not related to Sabido, the separate Vizuh learning product.

## Docs

- [docs/context.md](docs/context.md) — background, constraints, risks
- [docs/decisions.md](docs/decisions.md) — running decisions
- [docs/handoff.md](docs/handoff.md) — current state and next steps
- [log.md](log.md) — change history
