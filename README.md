# Sabi

Adaptive inference scheduling for AI agents.

Sabi sits between a coding harness and its model providers. The harness keeps its normal agent loop; Sabi decides which model, reasoning effort, and provider serves each inference round — continuously, across the whole trajectory, not just the first prompt.

**English** · [Português (BR)](README.pt-BR.md)

## Two adapters, one core

| | Class A — in-process mod | Class B — local proxy |
|---|---|---|
| Runs as | a Command Code mod (a hook on the harness loop) | an OpenAI-compatible endpoint on `127.0.0.1:8787` |
| Can choose | model **and** reasoning effort, from the Command Code catalog | model name only, from your own upstreams |
| Needs keys | no — it routes the subscription you already have | yes — your upstream credentials (OpenRouter, Ollama, …) |
| Failure signal | the harness's own `isError` (ground truth) | inferred from tool-output text |
| Use it for | Command Code | any harness that only accepts a `baseURL` |

Both reuse `packages/core` routing rules, but their signals and behavior differ. The mod uses explicit tool-error signals and plans continuing rounds; the proxy infers failures from text and can call Jev. `harness.tiers` contains Command Code catalog ids; `models` contains upstream model ids. Compare the adapters separately.

## Policy

Each round is classified from the state of the trajectory — round position, tool calls and their results, failure evidence, context size — and routed:

| Round | Rule | Tier |
|---|---|---|
| failing tool result | `failure` | strong |
| new instruction / first turn | `first-turn` | mid |
| tests / build / lint round | `verification` | mid |
| edit round | `implementation` | mid |
| read / search / bookkeeping | `exploration` | cheap |
| anything else | `unclassified` | cheap |

The proxy records routed rounds in `.sabi/decisions.jsonl` and summarizes them with `npm run report`. The mod records decisions as host session entries, which that report does not read. **Privacy:** records can contain tool-output excerpts and provider error text. Keep logs local until the [telemetry review](docs/research/folder-review.md) is addressed.

## Install — Command Code mod (recommended)

Requirements: Node 22.6+, Command Code, git access to this private repo, and a plan that covers the models in `harness.tiers` (see [Plan coverage](#plan-coverage)).

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install                                                    # .npmrc forces dev deps on this host
cmd mods add ./packages/adapters/command-code                  # registers the mod (project scope)
cmd mods list                                                  # → sabi · project · from local:/…/packages/adapters/command-code
```

The mod loads on your next session in that project (the first session also asks you to trust the workspace, which project mods require). Sabi then plans each continuing round; round 1 always runs on the session model, because `prepareNextTurn` fires only from the second round on.

To verify it is routing, ask for one file read and watch the model change between rounds:

```bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json
```

Turn 1 runs on the session model; turn 2 (a read round → `exploration` → cheap) runs on the cheap tier. Headless `-p` runs do not load project-scope mods, which is why the check passes `--mod` explicitly.

## Install — local proxy (BYOK / other harnesses)

```bash
npm install
export OPENROUTER_API_KEY=...    # upstream model credentials
export TYPESAFE_API_KEY=...      # Jev judge (optional; set judge.enabled false to skip)
npm start                        # http://127.0.0.1:8787/v1

npm run connect:command-code     # writes/updates the "sabi" provider in ~/.commandcode/providers.json
cmd --list-models | grep sabi    # verify the four models are visible
```

Then pick `sabi/sabi-code` in `/model` (or `--model sabi/sabi-code`). Fixed baseline aliases for comparison: `sabi-cheap`, `sabi-mid`, `sabi-strong`. `sabi-local` targets Ollama and is not exposed by default — its 32k window is too small for harness prompts.

Sabi is a foreground process, not a service: if it is not running, every `sabi/*` request fails with `ECONNREFUSED 127.0.0.1:8787` inside the harness. On this machine both keys come from the workspace secrets file:

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' ../../../secrets/.env | cut -d= -f2-)"
export TYPESAFE_API_KEY="$(grep -E '^typesafe=' ../../../secrets/.env | cut -d= -f2-)"
```

## Where Sabi finds its config

`sabi.config.json` is looked up in order, first hit wins:

1. `$SABI_CONFIG` — an explicit path (used alone when set)
2. `<cwd>/sabi.config.json` — project-local
3. `~/.config/sabi/sabi.config.json` — per-user (honours `XDG_CONFIG_HOME`)
4. the nearest `sabi.config.json` above the installed package — this is how a clone finds the config it shipped with

Decisions are written to `<cwd>/.sabi/decisions.jsonl`; override with `$SABI_LOG`.

## Plan coverage

`cmd --list-models` prints the **whole catalog regardless of your plan** — a listed model is not a usable model. Routing to one you cannot use fails that round outright:

```
Error: 403 MODEL_NOT_IN_PLAN: Claude Sonnet 5 available in Pro and above plans or extra on demand usage
```

So every id in `harness.tiers` must be covered by your plan. The shipped defaults are the strongest ids available **from the Go plan up**, verified live on 2026-09-18:

| Tier | Default (Go and above) | Pro and above | Max |
|---|---|---|---|
| cheap | `deepseek/deepseek-v4-flash` | same | same |
| mid | `gpt-5.6-luna` | `claude-sonnet-5` | `claude-sonnet-5` |
| strong | `zai-org/glm-5.3` | `claude-sonnet-5` | `claude-opus-5` |

Other Go-and-above candidates for `strong`: `moonshotai/kimi-k3`, `qwen/qwen3.8-max`, `deepseek/deepseek-v4-pro`. Edit `harness.tiers` to match your plan; `minPlan` is documentation, not enforcement.

## Configure

`sabi.config.json` holds:

- `upstreams` — base URLs and keys (keys as `$ENV_VAR` references, or `false` for keyless endpoints like Ollama)
- `models` — the class-B tiers: upstream model ids, context windows, prices
- `aliases` — what the harness sees (`sabi-code` = `auto`, plus fixed baselines)
- `policy` — rule → tier; `off` disables a rule
- `judge` — endpoint, model, thresholds, cache TTL, state budget
- `harness.tiers` — the class-A tiers: Command Code catalog ids, reasoning effort, `minPlan`

Model ids, context windows and prices were verified against the OpenRouter API on 2026-09-18; Jev's price ($0.042/Mtok input, output free) from the TypeSafe docs the same day; Command Code catalog ids and efforts from `cmd --list-models` and the bundled reference. All of it drifts — re-check before trusting cost math.

## Jev judgments

The **proxy only** consults Jev (TypeSafe's System One model) on these configured rules. The Command Code mod does not currently call Jev:

- `failure` rounds — "is this a real problem, or an expected outcome?" A low real-problem probability vetoes the escalation (for example: a command the user explicitly asked to fail).
- `unclassified` rounds — "how demanding is this step?" (`trivial` / `standard` / `demanding` → cheap / mid / strong) when its confidence clears the threshold.

One batched TypeSafe request covers both questions using excerpts of the last instruction and tool result plus round metadata, not the full conversation. The current 6k-character state target is not a strict serialized-size guarantee for all fields. Judgments are cached, cost roughly $0.00003 each, and are **fail-open**: any error or timeout falls back to the deterministic policy. Disable with `judge.enabled: false`.

## Verify

```bash
npm test        # state extraction, policy, judge, TypeSafe client, config discovery, proxy e2e (59 tests)
npm run typecheck
npm run report  # decisions, tokens, cost, savings vs an all-strong counterfactual, judge stats
```

## Layout

```
packages/core                    trajectory state, policy, judge application, router, config discovery, decision log
packages/server                  OpenAI-compatible proxy (SSE passthrough + tap), TypeSafe client, /v1/models, report
packages/adapters/command-code   the in-process mod (mod/sabi.ts) + the BYOK provider writer (src/connect.ts)
```

`npm run mod` loads the mod from a checkout. The proxy adds `stream_options.include_usage` for upstreams that support it, rewrites the response `model` field back to the synthetic alias, taps the SSE stream for usage, and logs decision records with the privacy limits described above. Judge calls are made before forwarding and are recorded on the decision (`judge.status`, probabilities, override direction, latency, token cost).

Planned: `evals`, `prime-agent` and `opencode` adapters, learned model profiles, quota awareness.

## Prior art

[docs/research/github-landscape.md](docs/research/github-landscape.md) — verified survey (2026-09-18) of the closest projects and the gap Sabi targets.

## Naming

Product name: **Sabi**. GitHub handles `sabi`, `uasabi` and `sabido` were taken, so the repo lives under the Vizuh namespace: https://github.com/vizuh/sabi (private). Not related to Sabido, the separate Vizuh learning product.

## Docs

- [Command Code roadmap](docs/research/command-code-roadmap.md) — proposed context/tool routing and acceptance checks
- [Folder review](docs/research/folder-review.md) — source findings and ready-to-post issue comments
- [Prime Agent reuse](docs/research/prime-agent-reuse.md) — installed evidence and patterns worth borrowing
- [docs/install.md](docs/install.md) — step-by-step install for someone else's machine
- [docs/context.md](docs/context.md) — background, constraints, risks
- [docs/decisions.md](docs/decisions.md) — running decisions
- [docs/handoff.md](docs/handoff.md) — current state and next steps
- [log.md](log.md) — change history
