# @vizuh/sabi

Adaptive inference scheduling for [Command Code](https://commandcode.ai): a mod that plans each
continuing round — model and reasoning effort — from the trajectory's own state (tool calls and
their results, failure evidence, context size). Round 1 always runs on your session model; from
round 2 on, a read round goes cheap, edits and tests go mid, and a failing tool escalates.

This package is the **mod only**. The local proxy (BYOK, for any harness that accepts a `baseURL`)
lives in the [repository](https://github.com/vizuh/sabi).

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
