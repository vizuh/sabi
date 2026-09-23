# @vizuh/sabi: Sabi inference adapter (Command Code mod)

Sabi is harness-independent adaptive inference scheduling for coding-agent trajectories:
per-round routing of model, effort and provider from trajectory evidence, while each host
harness keeps its own loop. Sabi promotes no single harness; every host below is a
peer surface with its own install path.

This npm artifact is the Command Code mod — one Sabi surface, not the whole product.
See the [adapter directory](../../../docs/adapters/README.md) for the product map and
evidence boundaries.

| Harness | Sabi surface | Install |
| --- | --- | --- |
| Claude Code | Controller hooks (task/session, fail-open) | `npm install --global @vizuh/sabi-controller` then `sabi setup` |
| Codex | Controller hooks (task/session, fail-open) | `npm install --global @vizuh/sabi-controller` then `sabi setup` |
| Command Code | This package: in-process mod, per-round model + reasoning effort | `cmd mods add -g npm:@vizuh/sabi` |
| Hermes | Local proxy + native `llm_request` middleware | Checkout-based setup in [the install guide](../../../docs/install.md) |
| Oh My Pi | Local proxy via OpenAI-compatible extension provider | Checkout: `omp --extension packages/adapters/oh-my-pi/src/sabi-extension.mjs --model sabi/sabi-code` |
| OpenCode | Local proxy, plus optional controller hook | Checkout-based proxy (`npm start` + `npm run connect:opencode`); hooks via `@vizuh/sabi-controller` |
| Orca | Controller plugin + inventory/dispatch bridge | `npm install --global @vizuh/sabi-controller` then `sabi setup` |
| DeepSeek Harness, Kilo, Cline, Prime Agent | Proxy or bundle paths | See the [adapter directory](../../../docs/adapters/README.md) |

Adaptive inference scheduling for [Command Code](https://commandcode.ai): a mod that plans each
continuing round, including model and reasoning effort, from the trajectory's own state (tool calls and
their results, failure evidence, context size). Round 1 always runs on your session model; from
round 2 on, a read round goes cheap, edits and tests go mid, and a failing tool escalates.

This package is the **mod only**. The local proxy (BYOK, for any harness that accepts a `baseURL`)
lives in the [repository](https://github.com/vizuh/sabi).

The two paths are independent:

- The Command Code mod needs no Sabi provider key or proxy. It routes the subscription already
  available to Command Code.
- The local proxy works with Hermes, Oh My Pi, OpenCode, and other OpenAI-compatible clients (including Cline, Kilo and Prime Agent paths). It uses
  OpenRouter, Ollama, or another configured upstream. In the shipped default the OpenRouter
  upstream is **free-models-only** (`paidModelsAllowed: false`): a priced model id is refused
  before the request leaves the process, so the proxy cannot spend on its own.

For the proxy, Sabi loads only the credential names referenced by `sabi.config.json`. Existing
environment variables win, followed by `SABI_SECRETS_FILE`, the nearest workspace `secrets/.env`,
and `~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. It does not copy loaded values into generated harness configuration or logs. If you use a workspace
secrets/.env, that source file is already in the worktree: keep it out of version control, add it to
.gitignore, and protect its file permissions. Users who do not use Jev can set `judge.enabled` to
`false`; users without a central secrets file can keep exporting provider variables normally.

## Install

```bash
cmd mods add -g npm:@vizuh/sabi
```

## Update

```bash
cmd mods update
```

## Uninstall

```bash
cmd mods remove sabi
```

## Configuration

The package ships a default `sabi.config.json` next to the bundle, so it works with no setup.
To change tiers, policy or telemetry, put your own `sabi.config.json` in the project you run in,
or at `~/.config/sabi/sabi.config.json`; both take precedence over the shipped default (or set
`SABI_CONFIG` to point at one explicitly).

`harness.tiers` defaults to the strongest Command Code ids available from the Go plan up. A model
that is listed by `cmd --list-models` is not necessarily covered by your plan: an out-of-plan tier
answers `403 MODEL_NOT_IN_PLAN` and fails that round, so check the ids against your plan.

Docs, decisions and the full changelog: https://github.com/vizuh/sabi
