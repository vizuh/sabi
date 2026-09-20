# Project Context

## Summary

Sabi is an adaptive inference scheduler for AI agents. A host coding harness keeps its normal agent loop; Sabi decides which model, reasoning effort, and provider serves each inference round based on the evolving state of the trajectory.

## Type

product (Vizuh; public repo `vizuh/sabi` — confirmed via `gh repo view` 2026-09-18)

## Audience

First user: Hugo's own agent workflows (Command Code, Prime Agent, OpenCode). Later: any harness or team that wants trajectory-level model scheduling without forking the harness.

## Core problem

Agentic coding tasks spend many inference rounds per task, and cost scales with rounds, not tasks. Request-level routers optimize one prompt; delegation frameworks move whole phases to another model. Neither schedules the model per round against the actual trajectory — tool results, failing tests, diffs, uncertainty, context growth — nor against live quota and cost.

Supporting evidence (verified 2026-09-18 — see `docs/research/github-landscape.md`):

- The closest existing implementation reports that most of its projected savings come from one rule: mid-loop tool-result steps routed to a cheaper tier (serhiileniv/claude-router README).
- The OpenCode tier router reports composite explore+execute tasks are ~65% of real coding sessions and splitting them saves ~36% (marco-jardim/opencode-model-router README).

## Business goal

Working hypothesis (not confirmed): lower cost per completed coding task, with equal or better task success, by scheduling inference rounds instead of choosing one model per request. TODO — ask Hugo for the concrete commercial goal and packaging.

## Success metrics

Hypotheses to validate before committing:

- cost per completed task vs. a fixed-model baseline on the same task set
- task success parity or improvement (tests passing, review acceptance)
- escalation precision: did escalated rounds actually need the stronger model
- routing overhead: latency and tokens spent deciding

## Current state

Current `main` (2026-09-20) contains the local OpenAI-compatible proxy, deterministic trajectory
routing, optional Jev judgments, the Command Code adapter, and the experimental user-level
controller with Claude/Codex hooks, an OpenCode bridge, Orca inventory, bounded handoff/reroute,
trace v1 and read-only replay. The controller now records runtime model catalogs for verified local
commands (`opencode models` and `cmd --list-models`) with explicit-free markers, Jev/worker role,
runtime version, observation time and output hash. Catalog presence is evidence only: it does not
prove plan entitlement, pricing, quota or per-round native OpenCode model switching.

A public DeepSeek Harness bundle adapter provides the same Sabi proxy boundary through DSH's native
`@deepseek-ai/dsh-llm-pi-ai` seam. It is inference-only and pinned to DSH `0.1.6-alpha.2` until a
live DSH boot/request/receipt probe is recorded; it does not add DSH lifecycle supervision.

The controller execution boundary now accepts only explicit typed Orca receipts, carries a
controller-side idempotency key through plan/route/outcome, reuses inventory for at most two seconds,
forces a fresh inventory before retrying a quota/rate-limit failure, and sends Jev only bounded
candidate/handoff state without catalogs or raw diffs. Unknown Orca result shapes are reported as
unverifiable rather than guessed.

The next phase is the deterministic harness × model × provider/plan × effort × session contract:
hard availability/capability/quota/token-evidence gates first, Jev only over the closed valid set,
then bounded execution and outcome receipts. Host token receipts, learned profiles, subscription
economics and policy compilation remain unimplemented until live evidence supports them.

## Key flows

Implemented (v0, Command Code):

1. The harness posts a chat completion to the local Sabi endpoint, addressed to the synthetic model `sabi-code`.
2. Sabi classifies the round from the request: position, last tool calls, tool results, failure evidence, context size.
3. On rounds the heuristics cannot settle (`failure`, `unclassified`), one bounded Jev request judges whether the failure is real and how demanding the step is; low confidence, errors or timeouts fall back to the deterministic policy.
4. The policy maps the round to a tier (cheap/mid/strong); `sabi.config.json` maps tiers to real upstream models.
5. Sabi rewrites the model, forwards to the OpenAI-compatible upstream (OpenRouter today), and streams the response back with the model field rewritten to `sabi-code`.
6. Usage is captured from the stream, cost estimated from configured rates, and the decision (including the judge outcome) appended to `.sabi/decisions.jsonl`; `npm run report` aggregates.

Planned: host token receipts, model/plan health evidence, learned model profiles, replay-based
policy evaluation and promotion gates.

## Constraints

- The host harness loop stays native — no forking or patching beyond supported extension surfaces.
- Provider/model facts (pricing, quota, capabilities) must be verified against live sources; no invented numbers.
- Upstream harness runtimes drift from releases; read the installed contract before designing an adapter.
- Keep the private/public boundary explicit; no secrets in Git.

## Known risks

- Harness adapters may depend on unstable extension points (Prime Agent's extension surface is documented but evolving).
- Outcome signals for model profiles are noisy (was the model wrong, or the prompt/context?).
- Provider pricing and model lineups change frequently; profiles and economics go stale.
- Crowded adjacent space (control planes, tier routers, agentic routing research) — differentiation must stay on trajectory-level scheduling, per `docs/research/github-landscape.md`.

## Important links

- Repo: https://github.com/vizuh/sabi (public)
- Local: `www/products/sabi`
- Prior-art survey: `docs/research/github-landscape.md`
- Production / Staging: none
- ClickUp: not created yet (bootstrap checklist item pending)
