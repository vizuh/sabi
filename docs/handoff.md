# Handoff Notes

## Current status

bootstrap — docs and research only, no code

## Last meaningful update

2026-09-18

## What was done recently

- Created `www/products/sabi` with private remote `github.com/vizuh/sabi`; registered in `www/_index/projects-index.md`.
- Wrote README, AGENTS.md/CLAUDE.md, `docs/context.md`, `docs/decisions.md`.
- Captured verified prior-art survey: `docs/research/github-landscape.md` (nine repos checked via `gh api`; four READMEs read directly; all read-only).

## What still needs to happen

1. Decide the stack for `packages/` (TypeScript is the presumed default given the harness ecosystems) and scaffold `packages/core`.
2. Define the core contract: trajectory-state fields, routing request/response shape, synthetic-model identity (`sabi-code`).
3. Define the Jev judgment interface (what is judged, in what shape, with what confidence).
4. Pick the first adapter (`command-code`) and read its installed extension surface before designing hooks.
5. Define the eval harness and baselines; consider CodeRouterBench methodology (LanceZPF/agent-as-a-router).
6. Close the remaining bootstrap-checklist items: ClickUp list + Project Memory doc (no ClickUp access in the bootstrap session).

## Current blockers

None technical. Unconfirmed: business goal and success metrics (marked TODO in `docs/context.md`).

## What to check first when reopening

- `git fetch` and confirm `origin/main` matches local before starting.
- `docs/context.md`, `docs/decisions.md`, `docs/research/github-landscape.md`.
- The installed Command Code provider/extension surface (verify against the live runtime, not docs alone).

## Files or areas that matter most

- `docs/research/github-landscape.md` — competitive evidence and the stated gap.
- `docs/decisions.md` — name/namespace, monorepo, docs-first decisions.

## Testing / verification notes

No code, so no tests. Bootstrap verification: `gh api` repo checks (2026-09-18), index edit, commit + remote SHA check after push.

## Quick restart note

Sabi schedules which model serves each inference round of a coding agent, based on trajectory state, model profiles, and live quota/cost, while the host harness keeps its loop. Start from the prior-art survey, then define the core routing contract before touching any adapter.
