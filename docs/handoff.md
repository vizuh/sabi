# Handoff Notes

## Current status

active — MVP testable on Command Code (deterministic policy v0)

## Last meaningful update

2026-09-18

## What was done recently

- Built the first working Sabi: `packages/core` (trajectory-state extraction, policy v0, router, decision log), `packages/server` (OpenAI-compatible proxy on 127.0.0.1:8787 with an SSE tap that rewrites the response model back to `sabi-code`, injects `stream_options.include_usage`, and captures usage), `packages/adapters/command-code` (idempotent `~/.commandcode/providers.json` writer).
- Wired tiers to live-verified OpenRouter models: cheap `deepseek/deepseek-v4-flash-0731`, mid `openai/gpt-5.6-luna`, strong `anthropic/claude-sonnet-5`; plus `local` → Ollama `qwen2.5-coder:7b`. Prices fetched from the OpenRouter API on 2026-09-18.
- 23 tests pass; typecheck clean.
- Live verification: Command Code headless sessions through `sabi/sabi-code` — first turn → mid, `read_file` round → cheap, failing-test round → strong; usage/cost recorded in `.sabi/decisions.jsonl` (7 decisions, ~$0.0104 vs ~$0.1329 all-strong counterfactual on a tiny sample — not a benchmark).
- Installed the `sabi` provider in `~/.commandcode/providers.json` (4 models; `sabi-code` context window 1,000,000 derived from the policy's tiers).

## What still needs to happen

1. Start Sabi (`npm start`, needs `OPENROUTER_API_KEY`) before using `sabi/sabi-code` — it is not running as a service.
2. Run a real session and read `npm run report`; validate escalation precision and savings on real work, not toy rounds.
3. Improve signals: verification detection from command intent plus output, escalation damping (avoid repeating strong on an unchanged failure), an "expected failure" guard — observed live: `node -e 'process.exit(3)'` requested by the user escalated a trivial round to Sonnet at 34.6k prompt tokens (~$0.069); context size dominates cost, so escalation is only cheap when the context is small — context-pressure rule (prefer a big-window model near limits), uncertainty heuristics.
4. Add `judges/jev` — a bounded semantic judgment layer (TypeSafe candidate) for rounds the heuristics cannot classify.
5. Economics inputs: quota/rate-limit awareness, and refresh of drifting provider prices.
6. Evaluation harness (`evals`) with fixed task sets; A/B `sabi-code` against `sabi-strong` using the baseline aliases.
7. Optionally expose reasoning effort per tier (Sabi currently declares none, so Command Code sends none).

## Current blockers

None technical. Unconfirmed: business goal and success metrics (marked TODO in `docs/context.md`).

## What to check first when reopening

- `git fetch`; confirm `origin/main` matches local.
- `docs/decisions.md` (integration path, policy v0, baseline aliases) and `docs/context.md`.
- Whether model ids/prices in `sabi.config.json` are still current — refetch the OpenRouter API.
- `.sabi/decisions.jsonl` for the most recent real-session decisions.

## Files or areas that matter most

- `sabi.config.json` — upstreams, tiers, aliases, policy (the product surface).
- `packages/core/src/state.ts` — round classification and failure heuristics (where routing quality lives).
- `packages/core/src/policy.ts` — rule order and tier decisions.
- `packages/server/src/server.ts` — proxy behavior, logging, error paths.

## Testing / verification notes

- `npm test` (23 tests: state, policy, proxy e2e with a mock upstream) and `npm run typecheck`.
- Live check without a harness: `curl -N http://127.0.0.1:8787/v1/chat/completions` with `model: "sabi-code"` and a tool-result conversation; then `npm run report`.
- Harness check: `cmd -p "..." --model sabi/sabi-code --skip-onboarding -t`.
- This host's npm config sets `omit=dev`; the repo `.npmrc` sets `include=dev` so plain `npm install` works.

## Quick restart note

Sabi is a local proxy that Command Code talks to as BYOK provider `sabi`. It classifies each agent round and picks cheap/mid/strong, escalating to strong on failing tool results. Start with `npm start` (needs `OPENROUTER_API_KEY`), pick `sabi/sabi-code` in `/model`, then read `.sabi/decisions.jsonl` and `npm run report` before changing policy or heuristics.
