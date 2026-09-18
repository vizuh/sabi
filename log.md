# Sabi — change log

Append-only, newest last. Entry format: `## [YYYY-MM-DD] type | title`.

## [2026-09-18] change | bootstrap Sabi

Created the Sabi product repo at `www/products/sabi` (remote: https://github.com/vizuh/sabi, private, empty before this commit). Docs-first bootstrap: README, AGENTS.md/CLAUDE.md, `docs/context.md`, `docs/decisions.md`, `docs/handoff.md`. Captured a verified prior-art survey at `docs/research/github-landscape.md` (nine repositories checked via `gh api` on 2026-09-18; four READMEs read directly; no clones, installs or runs). Registered in `www/_index/projects-index.md`.

No runtime code, no deployment, no external publication. Initial commit pushed to `origin/main` at `809edf1`.

## [2026-09-18] change | MVP: Sabi serves Command Code as a BYOK provider

Built the first testable Sabi. `packages/core`: trajectory-state extraction (round kind, failure heuristics, context size), deterministic policy v0 (failure > first-turn > verification > implementation > exploration > unclassified), router, JSONL decision log with cost estimation. `packages/server`: OpenAI-compatible proxy on `127.0.0.1:8787` with an SSE tap that rewrites the response model to the alias, injects `stream_options.include_usage`, captures usage, and logs decisions (metadata only, never prompt content); `/v1/models`, `/healthz`, `/decisions`; `npm run report` aggregates savings vs an all-strong counterfactual. `packages/adapters/command-code`: idempotent writer for `~/.commandcode/providers.json` (installed: provider `sabi`, models `sabi-code`, `sabi-cheap`, `sabi-mid`, `sabi-strong`; `sabi-code` context window 1,000,000 derived from the policy's tiers).

Tiers wired to OpenRouter models verified live on 2026-09-18 (`deepseek/deepseek-v4-flash-0731`, `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`) plus Ollama `qwen2.5-coder:7b` as `local` (not exposed to Command Code — 32k window). 23 tests pass, typecheck clean. Live verification: `cmd -p ... --model sabi/sabi-code` routed first-turn→mid, `read_file` round→cheap, failing-test round→strong; 7 decisions logged (~$0.0104 vs ~$0.1329 all-strong counterfactual on a tiny sample — not a benchmark).

No deployment, no publication, no harness modifications. Added `.npmrc` (`include=dev`): this host's npm config sets `omit=dev`, which would skip typescript/@types/node.

## [2026-09-18] change | Jev judgment layer (TypeSafe) live in the routing path

Added `packages/core/src/judge.ts` — bounded judge state (≤6k chars: last instruction, last tool excerpt, round metadata), a `noul` question ("is this a real problem or an expected outcome?") and a `choice` question ("how demanding is the step?"), plus override logic (veto escalation ≤0.25, confirm ≥0.6, difficulty override at confidence ≥0.6) — and `packages/server/src/typesafe.ts` — TypeSafe System One client (`POST /v1/systemone`, `jev-latest`) with answer validation, one retry on 429/529/5xx, timeout, LRU cache, and fail-open behavior. Judge runs only on `failure` and `unclassified` rounds (config `judge.callOn`), before forwarding; its outcome, latency, token cost and override direction are recorded on the decision and summarized in `npm run report`.

Validation: 41 tests pass (state, policy, judge application, TypeSafe client against mocked responses, proxy e2e with a stubbed Jev) and typecheck is clean. Live TypeSafe calls confirmed the fix for the previously observed false escalation — a user-requested failing command now routes to cheap (real-problem 0.04, difficulty trivial) instead of Sonnet, while genuine failing tests still escalate (real-problem 0.95) — verified both by direct proxy calls and by a real Command Code headless session (`cmd -p ... --model sabi/sabi-code`). Judge latency 0.3–0.8s, ~650 input tokens (~$0.00003) per judged round; `report` shows 1 downgrade from 2 judged rounds in this sample (not a benchmark).

TypeSafe price ($0.042/Mtok input, output free) taken from the live docs on 2026-09-18 and recorded in `sabi.config.json`. No publication, no deployment, no harness modifications.
