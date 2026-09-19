# Sabi

Adaptive inference scheduling for AI agents.

Sabi sits between a coding harness and its model providers. The harness keeps its normal agent loop; Sabi decides which model, reasoning effort, and provider serves each inference round — continuously, across the whole trajectory, not just the first prompt.

**English** · [Português (BR)](README.pt-BR.md) · [中文](README.zh-CN.md)

## Two adapters, one core

| | Class A — in-process mod | Class B — local proxy |
|---|---|---|
| Runs as | a Command Code mod (a hook on the harness loop) | an OpenAI-compatible endpoint on `127.0.0.1:8787` |
| Can choose | model **and** reasoning effort, from the Command Code catalog | model name only, from your own upstreams |
| Needs keys | no — it routes the subscription you already have | yes — your upstream credentials (OpenRouter, Ollama, …) |
| Failure signal | the harness's own `isError` (ground truth) | inferred from tool-output text |
| Use it for | Command Code | any harness that only accepts a `baseURL` |

Both reuse `packages/core` routing rules, but their signals and behavior differ. The mod uses explicit tool-error signals and plans continuing rounds; the proxy infers failures from text and can call Jev. `harness.tiers` contains Command Code catalog ids; `models` contains upstream model ids. Compare the adapters separately.

`npm run setup` picks the right one interactively — see [Quick setup](docs/install.md#quick-setup).

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

The proxy records routed rounds in `.sabi/decisions.jsonl` and summarizes them with `npm run report`. The mod records decisions as host session entries, which that report does not read. **Privacy:** default telemetry stores allowlisted evidence and hashed opaque identities; diagnostic snippets are opt-in. Keep logs local and review `telemetry` settings before enabling capture.

**Measured context and host compaction.** When a client identifies its session (`x-sabi-session`), the proxy floors its context estimate with the provider's own billed total for the previous round — measured usage, not a character count — and treats a transcript that comes back below half its previous message count as a host compaction. A boundary advances a context generation, which keeps cached Jev verdicts from crossing the rewrite, and restarts the repeated-failure streak: a failure after a rewrite is one fresh failure, not a continuation of the attempt the host discarded. The host still owns compaction — Sabi rewrites no transcript on either adapter. On the mod path the same two signals come from the host's `usage` and from `state.messages` shrinking.

**Provider and subscription limits.** A rate limit, session/usage/quota limit or timeout is a transport condition, not a task failure: the round retries on the transport tier and is never escalated to a stronger model. Wording decides: a named limit (`rate limit`, `session limit`, `too many requests`) outranks an error-looking line in the same result, while a bare status code does not — a failing test that prints a 429 still escalates.

## Media and vision

Media is a routing constraint, not a preference decided after the fact. Every tier can declare the input modalities its model accepts (`capabilities.inputModalities` on the proxy, `inputModalities` on `harness.tiers`). A round that carries an image is never sent to a tier that declares text only — it is served by the first tier in configuration order that declares the modality, and the decision records `rule: capability`. Undeclared stays unknown: a tier that declares nothing is never blocked.

| Tier | Proxy (`models`) | Mod (`harness.tiers`) |
|---|---|---|
| cheap | `deepseek/deepseek-v4-flash-0731` — text only | `deepseek/deepseek-v4-flash` — text only |
| mid | `openai/gpt-5.6-luna` — text, image, file | `gpt-5.6-luna` — text, image |
| strong | `anthropic/claude-sonnet-5` — text, image, file | `zai-org/glm-5.3` — text only |

What happens when nothing can serve the round:

- **Adaptive alias (`sabi-code`)** — the round moves to a tier that can read it. Verified live: an exploration round carrying an image planned for the text-only cheap tier was served by `openai/gpt-5.6-luna` (`rule: capability`), instead of failing upstream with `404 No endpoints found that support image input`.
- **Fixed alias (`sabi-cheap`)** — refused, with `400 incompatible route 'cheap': input modality 'image' is not supported`. A baseline alias is an explicit model choice and does not silently upgrade.
- **No tier at all** — refused at the proxy; on the mod path the round is left on the session model, because the host strips images for a text-only model and routing there would answer blind.

Media is also charged to the context estimate: each image costs 1500 tokens (the host's own bound, not the base64 length, which says nothing about image tokens) and other media are charged by payload size, so a screenshot round no longer looks like a tiny round to the context-pressure rule. `contextChars` stays text-only; `state.inputModalities` and `state.mediaCounts` are recorded on every decision.

Declared modalities must be verified per model id, not inferred from the family: on OpenRouter `deepseek/deepseek-v4-flash-0731` is text-only while `deepseek/deepseek-v4-flash-vision-exp` accepts images, and in the Command Code catalog `gpt-5.6-luna` accepts images while `zai-org/GLM-5.3` does not.

## Install — Command Code mod (recommended)

Requirements: Node 22.6+, Command Code, git (this repo is public), and a plan that covers the models in `harness.tiers` (see [Plan coverage](#plan-coverage)).

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install                                                    # .npmrc forces dev deps on this host
cmd mods add ./packages/adapters/command-code                  # registers the mod (project scope)
cmd mods list                                                  # → sabi · project · from local:/…/packages/adapters/command-code
```

Or install the same mod without cloning — it is published as a bundled npm package with no runtime dependencies (mod only; the proxy path below still needs the clone):

```bash
cmd mods add -g npm:@vizuh/sabi                                # user scope; update later with `cmd mods update`
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
npm start                        # http://127.0.0.1:8787/v1

npm run connect:command-code     # writes/updates the "sabi" provider in ~/.commandcode/providers.json
cmd --list-models | grep sabi    # verify the four models are visible

npm run connect:opencode         # OpenCode: merges the "sabi" provider into ~/.config/opencode/opencode.json
```

Then pick `sabi/sabi-code` in `/model` (or `--model sabi/sabi-code`). Fixed baseline aliases for comparison: `sabi-cheap`, `sabi-mid`, `sabi-strong`. `sabi-local` targets Ollama and is not exposed by default — its 32k window is too small for harness prompts. Other clients — OpenCode and Hermes, with what they do and do not get — are covered in [docs/install.md](docs/install.md#clients-other-than-command-code).

Sabi is a foreground process, not a service: if it is not running, every `sabi/*` request fails with `ECONNREFUSED 127.0.0.1:8787` inside the harness.

## Agent Controller daemon (experimental)

The separate controller surface is intended to run once per user rather than once per worktree.
The public controller package is separate from the inference adapter:

```bash
npm install --global @vizuh/sabi-controller
sabi setup --hooks               # writes user state, starts daemon and installs host hooks
sabi status
sabi route "review this change"
sabi sessions --json              # bounded adapter registrations
sabi integrations list
sabi upgrade --version=0.1.0    # exact-version rollback is also supported
sabi uninstall                   # restores Sabi hook backups and archives Sabi state
sabi replay --last=1000         # read-only decision/outcome summary
```

The first `@vizuh/sabi-controller` release is prepared by the `controller-v*` workflow. Until a
controller tag is published, `npm run build:controller` from this repository is a maintainer/CI
check, not an end-user installation path. It produces a self-contained tarball with the CLI,
daemon, hooks, OpenCode plugin and Orca bridge resources; it does not require this checkout or its
`node_modules` at runtime.

`setup` detects installed harness executables and enables automatic controller routing through
the daemon. With `--hooks`, it merges a Sabi `UserPromptSubmit` hook into Claude Code and Codex,
and installs the small OpenCode `chat.message` plugin. Existing JSON configuration is preserved and
backed up once as `<file>.sabi-backup`. A `CONTINUE` plan is silent; delegation only blocks the
current prompt after the daemon reports that the target accepted execution. Hook failures fail open,
so opening a harness still works if Sabi is stopped. These hooks route controller execution; they do
not silently switch a paid subscription or the model selected inside a harness.

To install or repair hooks separately, run `sabi hooks install` (or select `--claude`, `--codex`, or
`--opencode`). On Linux, `sabi setup` also attempts a per-user `systemd --user` service and reports a
lazy detached fallback when the user bus is unavailable. macOS and Windows service installers remain
unsupported until validated. Use `sabi integrations list` to distinguish an executable from a
controller-integrated harness. The daemon is loopback-only and reuses live Orca inventory when Orca
is available; live universal OpenCode/Orca activation remains a separate gate.

The controller can also route by the plans actually visible on this machine. Configure
`controller.preferredHarnesses` and per-harness `preferredModels` in `sabi.config.json`; it checks
`cmd --list-models` or `opencode models` locally, then combines that result with Orca's observed
session capacity. For example, `opencode-go/kimi-k3` can be selected for a new OpenCode terminal
while `moonshotai/kimi-k3` remains a Command Code candidate. A quota-exhausted Command Code session
therefore falls back to an available OpenCode session or spawn candidate without a provider API call
or credential transfer. The Orca fallback list also accepts `claude`, `codex` and `hermes`; a harness
is eligible only when its executable/session is actually present. Existing sessions keep their
currently selected model; exact model selection is guaranteed only for a controller-spawned terminal
(`opencode --model ...` or `cmd --model ...`).

Controller records use trace schema v1: bounded candidate descriptors, the closed valid-action set,
the selected route, execution status and elapsed time. `sabi replay` reads those JSONL records without
calling a harness, so policy changes can be evaluated against observed traffic before execution.

The public `@vizuh/sabi` GitHub/npm release publishes the Command Code adapter, not the controller.
The controller has its own `@vizuh/sabi-controller` package and release lane. A published controller
release must still pass the clean-machine package test and the host-integration evidence gates in
`docs/research/public-installation-plan.md`; package installation alone does not prove live Orca
activation or cross-terminal execution.

At startup the proxy loads only the credential names referenced by the active config. Existing
environment variables win, then `SABI_SECRETS_FILE`, the nearest workspace `secrets/.env`, and
finally `~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. A dotenv file can use
`OPENROUTER_API_KEY=...` and `TYPESAFE_API_KEY=...`; the HugoOS workspace's existing `typesafe=...`
name is also accepted for the TypeSafe key. No secret is copied into a harness config, terminal,
worktree, log or Git. The Command Code mod remains keyless; OpenCode, Hermes, Kilo and other
OpenAI-compatible clients only point at the local proxy, while their own account credentials stay
with the harness.

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
- `controller` — preferred harness order and local model ids used by the Orca controller
- `harness.tiers` — the class-A tiers: Command Code catalog ids, reasoning effort, `minPlan`

Model ids, context windows and prices were verified against the OpenRouter API on 2026-09-18; Jev's price ($0.042/Mtok input, output free) from the TypeSafe docs the same day; Command Code catalog ids and efforts from `cmd --list-models` and the bundled reference. All of it drifts — re-check before trusting cost math.

## Jev judgments

The **proxy only** consults Jev (TypeSafe's System One model) on these configured rules. The Command Code mod does not currently call Jev:

- `failure` rounds — "is this a real problem, or an expected outcome?" A low real-problem probability vetoes the escalation (for example: a command the user explicitly asked to fail).
- `unclassified` rounds — "how demanding is this step?" (`trivial` / `standard` / `demanding` → cheap / mid / strong) when its confidence clears the threshold.

One batched TypeSafe request covers all three questions using excerpts of the last instruction and tool result plus round metadata, not the full conversation. The third question is **shadow mode only**: it scores whether the last tool result is redundant for the next step, and the answer is recorded on the decision (`judge.evidenceRedundant`) and counted by `npm run report` — nothing is dropped or rewritten, no route changes, and it stays unverified until it has been measured on real traffic. The current 6k-character state target is not a strict serialized-size guarantee for all fields. Judgments are cached, cost roughly $0.00003 each, and are **fail-open**: any error or timeout falls back to the deterministic policy. Disable with `judge.enabled: false`.

## Verify

```bash
npm test        # core, proxy, adapter-profile and eval tests
npm run typecheck
npm run report  # decisions, tokens, cost, savings vs an all-strong counterfactual, judge stats,
                # a `discover` block (vetoes and the cost they avoided, blind spots, dead rules),
                # and the shadow evidence-redundancy count — measured, never applied
```

## Layout

```
packages/core                    trajectory state, policy, judge application, router, config discovery, decision log
packages/server                  OpenAI-compatible proxy (SSE passthrough + tap), TypeSafe client, /v1/models, report
packages/adapters/command-code   the in-process mod (mod/sabi.ts) + the BYOK provider writer (src/connect.ts)
packages/adapters/opencode       OpenCode config writer (npm run connect:opencode)
packages/adapters/hermes         opt-in metadata bridge and isolated compatibility probe
packages/adapters/prime-agent   private isolated proxy/timing probe; no native adapter
```

`npm run mod` loads the mod from a checkout. The proxy uses one shared effective-envelope check before adding `stream_options.include_usage` for eligible upstreams, rewrites the response `model` field back to the synthetic alias, taps the SSE stream for usage, and logs decision records with the privacy limits described above. Judge calls are made before forwarding and are recorded on the decision (`judge.status`, probabilities, override direction, latency, token cost).

The compatibility notes and isolated probes for Hermes, Prime Agent, OpenCode and Kilo live in [docs/harnesses.md](docs/harnesses.md). Native per-round hooks remain gated until same-trajectory behavior is proven. Future work includes learned model profiles and quota awareness.

## Prior art

[docs/research/github-landscape.md](docs/research/github-landscape.md) — verified survey (2026-09-18) of the closest projects and the gap Sabi targets.

## Naming

Product name: **Sabi**. GitHub handles `sabi`, `uasabi` and `sabido` were taken, so the repo lives under the Vizuh namespace: https://github.com/vizuh/sabi (public). Not related to Sabido, the separate Vizuh learning product.

## Docs

- [Command Code roadmap](docs/research/command-code-roadmap.md) — proposed context/tool routing and acceptance checks
- [Folder review](docs/research/folder-review.md) — source findings and ready-to-post issue comments
- [Prime Agent reuse](docs/research/prime-agent-reuse.md) — installed evidence and patterns worth borrowing
- [RTK learnings](docs/research/rtk-learnings.md) — what a context compressor teaches a router: claim discipline, a discover view, and seeing through a rewrite prefix
- [docs/install.md](docs/install.md) — step-by-step install for someone else's machine
- [docs/context.md](docs/context.md) — background, constraints, risks
- [docs/decisions.md](docs/decisions.md) — running decisions
- [docs/handoff.md](docs/handoff.md) — current state and next steps
- [log.md](log.md) — change history
