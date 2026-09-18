# Project Context

## Summary

Sabi is an adaptive inference scheduler for AI agents. A host coding harness keeps its normal agent loop; Sabi decides which model, reasoning effort, and provider serves each inference round based on the evolving state of the trajectory.

## Type

product (Vizuh; private repo `vizuh/sabi`)

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

MVP (2026-09-18): Sabi runs as a local OpenAI-compatible proxy (`packages/server`) with a deterministic policy (`packages/core`), a Jev judgment layer (TypeSafe System One) for rounds the heuristics cannot settle, and is connected to Command Code as a keyless BYOK provider (`sabi/sabi-code`). Verified end-to-end: 41 tests green, typecheck clean, and live Command Code headless sessions routing first-turn rounds to mid, tool rounds to cheap, failing-test rounds to strong, and — with Jev — vetoing false escalations (a user-requested failing command now routes to cheap instead of strong). No learned profiles or quota awareness yet.

## Key flows

Implemented (v0, Command Code):

1. The harness posts a chat completion to the local Sabi endpoint, addressed to the synthetic model `sabi-code`.
2. Sabi classifies the round from the request: position, last tool calls, tool results, failure evidence, context size.
3. On rounds the heuristics cannot settle (`failure`, `unclassified`), one bounded Jev request judges whether the failure is real and how demanding the step is; low confidence, errors or timeouts fall back to the deterministic policy.
4. The policy maps the round to a tier (cheap/mid/strong); `sabi.config.json` maps tiers to real upstream models.
5. Sabi rewrites the model, forwards to the OpenAI-compatible upstream (OpenRouter today), and streams the response back with the model field rewritten to `sabi-code`.
6. Usage is captured from the stream, cost estimated from configured rates, and the decision (including the judge outcome) appended to `.sabi/decisions.jsonl`; `npm run report` aggregates.

Planned: learned model profiles, quota/economics inputs, evaluation loop.

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

- Repo: https://github.com/vizuh/sabi (private)
- Local: `www/products/sabi`
- Prior-art survey: `docs/research/github-landscape.md`
- Related but separate product: Sabido (`www/products/sabido`)
- Production / Staging: none
- ClickUp: not created yet (bootstrap checklist item pending)
