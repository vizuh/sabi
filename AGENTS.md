# Sabi — agent instructions

Begin every response with `VIZUH`. On Hugo's host, read the HugoOS root `AGENTS.md` first; this file is the project overlay for this repository.

Sabi is a Vizuh product: adaptive inference scheduling for AI agents — per-round routing of model, effort and provider across a coding-agent trajectory, while the host harness keeps its own loop.

## Repository

- Canonical checkout: `/home/hugocarvalho/Desktop/HugoOS/www/products/sabi`
- Remote: https://github.com/vizuh/sabi (public — confirmed via `gh repo view` 2026-09-18; earlier docs said private, that was stale)

## Where things live

- `docs/context.md` — what Sabi is, constraints, risks
- `docs/decisions.md` — running decision log (template: `www/_shared/templates/workflow/docs/decisions.md`)
- `docs/handoff.md` — current status; update at the end of meaningful work
- `docs/research/` — verified external research (prior art, harness capabilities)
- `docs/research/public-installation-plan.md` — public CLI, daemon, host integration and release gates
- `log.md` — append-only change log; one entry per meaningful change set
- Current code groups: `packages/core`, `packages/server`, `packages/controller`, `packages/evals`, and `packages/adapters/{command-code,orca,opencode,prime-agent}`.

## Working rules

- **Verified vs unverified is explicit.** Cite exact repos, commits, dates and observed numbers for upstream claims. Never invent benchmarks, model capabilities, pricing or quota behavior — verify against live sources or label the claim unverified.
- **Read installed runtimes before designing adapters.** Harness docs drift from releases (Prime Agent is a known example); the installed contract wins over copied upstream syntax.
- **Keep the harness loop native.** Sabi schedules inference rounds; it does not fork or patch a host harness beyond its supported extension surface.
- **Secrets never enter Git.** Provider keys live in the environment only; no credentials, cookies or raw usage logs in the repo.
- **Delivery discipline.** Push deliberately; a local commit is not delivery and a push is not a deployment. No external publication without explicit approval.
- Keep docs short and true; `TODO — ask Hugo` beats invented detail.

## Current controller and release boundary

- `sabi setup --hooks` and `sabi hooks install` install the experimental Claude, Codex and OpenCode controller bridges. They fail open when Sabi is unavailable and do not switch paid subscriptions or harness-selected models.
- `sabi replay --last=<n>` is read-only telemetry aggregation; it does not re-run historical tasks or compile policy lessons.
- The root controller remains a private monorepo workspace, while `npm run build:controller` produces the separate `@vizuh/sabi-controller` public-package staging artifact. The `@vizuh/sabi` tag release still publishes only the packaged Command Code adapter; do not claim the controller package is published until a `controller-v*` tag and registry proof exist.
- Report controller support as separate evidence layers: source/tests, merged GitHub state, installed-config mutation, live host activation, and real cross-terminal execution. Do not promote one layer into another.
