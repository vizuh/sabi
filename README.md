# Sabi

Adaptive inference scheduling for AI agents.

Sabi sits between a coding harness and its model providers. The harness keeps its normal agent loop; Sabi decides which model, reasoning effort, and provider serves each inference round — continuously, across the whole trajectory, not just the first prompt.

Working today: Sabi runs as a local, keyless OpenAI-compatible endpoint that Command Code connects to as a BYOK provider. Each round is classified from the request itself — round position, tool calls and their results, failure evidence, context size — and routed per policy:

| Round | Rule | Tier | Default model |
|---|---|---|---|
| failing tool result | `failure` | strong | `anthropic/claude-sonnet-5` |
| new instruction / first turn | `first-turn` | mid | `openai/gpt-5.6-luna` |
| tests / build / lint round | `verification` | mid | `openai/gpt-5.6-luna` |
| edit round | `implementation` | mid | `openai/gpt-5.6-luna` |
| read / search / bookkeeping | `exploration` | cheap | `deepseek/deepseek-v4-flash-0731` |
| anything else | `unclassified` | cheap | `deepseek/deepseek-v4-flash-0731` |

Every routed round is recorded in `.sabi/decisions.jsonl` (metadata, usage and estimated cost — never prompt content) and summarized by `npm run report`.

## Jev judgments

Before a round is served, Jev (TypeSafe's System One model) is consulted **only where the heuristics are blind**:

- `failure` rounds — "is this a real problem, or an expected outcome?" A low real-problem probability vetoes the escalation (for example: a command the user explicitly asked to fail).
- `unclassified` rounds — "how demanding is this step?" (`trivial` / `standard` / `demanding` → cheap / mid / strong) when its confidence clears the threshold.

One batched TypeSafe request covers both questions, with bounded state (≤6k chars: last instruction, last tool excerpt, round metadata — never the full conversation). Judgments are cached, cost roughly $0.00003 each, and are **fail-open**: any error or timeout falls back to the deterministic policy. Disable with `judge.enabled: false` in `sabi.config.json`.

## Run

    npm install                      # .npmrc forces dev deps: this host's npm config omits them
    export OPENROUTER_API_KEY=...    # upstream model credentials
    export TYPESAFE_API_KEY=...      # Jev judge (optional; disable it in the config to skip)
    npm start                        # http://127.0.0.1:8787/v1

On this machine both keys come from the workspace secrets file:

    export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' ../../../secrets/.env | cut -d= -f2-)"
    export TYPESAFE_API_KEY="$(grep -E '^typesafe=' ../../../secrets/.env | cut -d= -f2-)"

Enable it in Command Code:

    npm run connect:command-code     # writes/updates the "sabi" provider in ~/.commandcode/providers.json
    cmd --list-models | grep sabi    # verify the four models are visible

Then pick `sabi/sabi-code` in `/model` (or `--model sabi/sabi-code`). Fixed baseline aliases for comparison: `sabi-cheap`, `sabi-mid`, `sabi-strong`. `sabi-local` targets Ollama and is not exposed by default — its 32k window is too small for harness prompts.

## Verify

    npm test        # state extraction, policy, judge logic, TypeSafe client, proxy e2e (41 tests)
    npm run typecheck
    npm run report  # decisions, tokens, cost, savings vs an all-strong counterfactual, judge stats

## Configure

`sabi.config.json` holds upstreams (keys as `$ENV_VAR` references), model tiers with prices, aliases, the policy map (rule → tier; `off` disables a rule), and the `judge` block (endpoint, model, thresholds, cache TTL, state budget). Model ids, context windows and prices were verified against the OpenRouter API on 2026-09-18; Jev's price ($0.042/Mtok input, output free) from the TypeSafe docs the same day — re-check before trusting cost math. The `local` tier is an Ollama upstream (`qwen2.5-coder:7b`).

## Layout

    packages/core                    trajectory state, policy, judge application, router, config, decision log
    packages/server                  OpenAI-compatible proxy (SSE passthrough + tap), TypeSafe client, /v1/models, report
    packages/adapters/command-code   writes the BYOK provider entry into ~/.commandcode/providers.json

The proxy adds `stream_options.include_usage` for upstreams that support it, rewrites the response `model` field back to the synthetic alias, taps the SSE stream for usage, and never logs prompt content. Judge calls are made before forwarding and are recorded on the decision (`judge.status`, probabilities, override direction, latency, token cost).

Planned: `evals`, `prime-agent` and `opencode` adapters, learned model profiles, quota awareness.

## Prior art

[docs/research/github-landscape.md](docs/research/github-landscape.md) — verified survey (2026-09-18) of the closest projects and the gap Sabi targets.

## Naming

Product name: **Sabi**. GitHub handles `sabi`, `uasabi` and `sabido` were taken, so the repo lives under the Vizuh namespace: https://github.com/vizuh/sabi (private). Not related to Sabido, the separate Vizuh learning product.

## Docs

- [docs/context.md](docs/context.md) — background, constraints, risks
- [docs/decisions.md](docs/decisions.md) — running decisions
- [docs/handoff.md](docs/handoff.md) — current state and next steps
- [log.md](log.md) — change history
