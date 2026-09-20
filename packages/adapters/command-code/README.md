# @vizuh/sabi — Command Code adapter

This npm artifact is one Sabi adapter, not the whole Sabi product. Sabi also supports a local
OpenAI-compatible proxy for OpenCode, Hermes, Prime Agent, Kilo and other clients, plus an
experimental controller surface for Claude Code, Codex and Orca. See the
[adapter directory](../../../docs/adapters/README.md) for the product map and evidence boundaries.

Adaptive inference scheduling for [Command Code](https://commandcode.ai): a mod that plans each
continuing round — model and reasoning effort — from the trajectory's own state (tool calls and
their results, failure evidence, context size). Round 1 always runs on your session model; from
round 2 on, a read round goes cheap, edits and tests go mid, and a failing tool escalates.

This package is the **mod only**. The local proxy (BYOK, for any harness that accepts a `baseURL`)
lives in the [repository](https://github.com/vizuh/sabi).

The two paths are independent:

- **Command Code mod:** no Sabi provider key and no proxy; it routes the subscription already
  available to Command Code.
- **Local proxy:** works with OpenCode, Hermes, Kilo and other OpenAI-compatible clients, using
  OpenRouter, Ollama or another configured upstream.

For the proxy, Sabi loads only the credential names referenced by `sabi.config.json`. Existing
environment variables win, followed by `SABI_SECRETS_FILE`, the nearest workspace `secrets/.env`,
and `~/.config/sabi/secrets.env` or `~/.config/sabi/.env`. It never copies secret values into a
harness config, terminal, worktree, log or Git. Users who do not use Jev can set `judge.enabled` to
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
or at `~/.config/sabi/sabi.config.json` — both take precedence over the shipped default (or set
`SABI_CONFIG` to point at one explicitly).

`harness.tiers` defaults to the strongest Command Code ids available from the Go plan up. A model
that is listed by `cmd --list-models` is not necessarily covered by your plan: an out-of-plan tier
answers `403 MODEL_NOT_IN_PLAN` and fails that round, so check the ids against your plan.

Docs, decisions and the full changelog: https://github.com/vizuh/sabi
