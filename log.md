# Sabi — change log

Append-only, newest last. Entry format: `## [YYYY-MM-DD] type | title`.

## [2026-09-18] change | bootstrap Sabi

Created the Sabi product repo at `www/products/sabi` (remote: https://github.com/vizuh/sabi, private, empty before this commit). Docs-first bootstrap: README, AGENTS.md/CLAUDE.md, `docs/context.md`, `docs/decisions.md`, `docs/handoff.md`. Captured a verified prior-art survey at `docs/research/github-landscape.md` (nine repositories checked via `gh api` on 2026-09-18; four READMEs read directly; no clones, installs or runs). Registered in `www/_index/projects-index.md`.

No runtime code, no deployment, no external publication. Initial commit pushed to `origin/main` at `809edf1`.

## [2026-09-18] change | MVP: Sabi serves Command Code as a BYOK provider

Built the first testable Sabi. `packages/core`: trajectory-state extraction (round kind, failure heuristics, context size), deterministic policy v0 (failure > first-turn > verification > implementation > exploration > unclassified), router, JSONL decision log with cost estimation. `packages/server`: OpenAI-compatible proxy on `127.0.0.1:8787` with an SSE tap that rewrites the response model to the alias, injects `stream_options.include_usage`, captures usage, and logs decisions (metadata only, never prompt content); `/v1/models`, `/healthz`, `/decisions`; `npm run report` aggregates savings vs an all-strong counterfactual. `packages/adapters/command-code`: idempotent writer for `~/.commandcode/providers.json` (installed: provider `sabi`, models `sabi-code`, `sabi-cheap`, `sabi-mid`, `sabi-strong`; `sabi-code` context window 1,000,000 derived from the policy's tiers).

Tiers wired to OpenRouter models verified live on 2026-09-18 (`deepseek/deepseek-v4-flash-0731`, `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`) plus Ollama `qwen2.5-coder:7b` as `local` (not exposed to Command Code — 32k window). 23 tests pass, typecheck clean. Live verification: `cmd -p ... --model sabi/sabi-code` routed first-turn→mid, `read_file` round→cheap, failing-test round→strong; 7 decisions logged (~$0.0104 vs ~$0.1329 all-strong counterfactual on a tiny sample — not a benchmark).

No deployment, no publication, no harness modifications. Added `.npmrc` (`include=dev`): this host's npm config sets `omit=dev`, which would skip typescript/@types/node.
