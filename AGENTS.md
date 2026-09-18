# Sabi — agent instructions

Begin every response with `VIZUH`. On Hugo's host, read the HugoOS root `AGENTS.md` first; this file is the project overlay for this repository.

Sabi is a Vizuh product: adaptive inference scheduling for AI agents — per-round routing of model, effort and provider across a coding-agent trajectory, while the host harness keeps its own loop.

## Repository

- Canonical checkout: `/home/hugocarvalho/Desktop/HugoOS/www/products/sabi`
- Remote: https://github.com/vizuh/sabi (public — confirmed via `gh repo view` 2026-09-18; earlier docs said private, that was stale)
- Not Sabido. Sabido (`www/products/sabido`) is a separate Vizuh product; never merge the two scopes.

## Where things live

- `docs/context.md` — what Sabi is, constraints, risks
- `docs/decisions.md` — running decision log (template: `www/_shared/templates/workflow/docs/decisions.md`)
- `docs/handoff.md` — current status; update at the end of meaningful work
- `docs/research/` — verified external research (prior art, harness capabilities)
- `log.md` — append-only change log; one entry per meaningful change set
- Planned code layout (not yet scaffolded): `packages/core`, `packages/judges/jev`, `packages/evals`, `packages/adapters/{command-code,prime-agent,opencode}`

## Working rules

- **Verified vs unverified is explicit.** Cite exact repos, commits, dates and observed numbers for upstream claims. Never invent benchmarks, model capabilities, pricing or quota behavior — verify against live sources or label the claim unverified.
- **Read installed runtimes before designing adapters.** Harness docs drift from releases (Prime Agent is a known example); the installed contract wins over copied upstream syntax.
- **Keep the harness loop native.** Sabi schedules inference rounds; it does not fork or patch a host harness beyond its supported extension surface.
- **Secrets never enter Git.** Provider keys live in the environment only; no credentials, cookies or raw usage logs in the repo.
- **Delivery discipline.** Push deliberately; a local commit is not delivery and a push is not a deployment. No external publication without explicit approval.
- Keep docs short and true; `TODO — ask Hugo` beats invented detail.
