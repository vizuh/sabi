# Sabi × DeepSeek Harness

This package is the official Sabi **bundle adapter** for DeepSeek Harness (DSH).
It adds a `sabi/sabi-code`-style provider route to DSH's native
`@deepseek-ai/dsh-llm-pi-ai` adapter. DSH keeps its session, tools, approvals,
streaming and agent loop; Sabi receives the OpenAI-compatible model request and
chooses the configured upstream behind its local proxy.

## Compatibility boundary

The adapter was authored against DeepSeek Harness `0.1.6-alpha.2`, upstream
revision [`ddefc45fbc7f8e46dd73185e68295696d1297887`](https://github.com/deepseek-ai/deepseek-harness/tree/ddefc45fbc7f8e46dd73185e68295696d1297887).
DSH is in developer preview and may make breaking changes. This package is an
inference-only adapter: it does not install a DSH runtime, supervise a DSH
process, identify DSH sessions, or move work between harnesses.

The published bundle currently exposes one text route:

```text
provider: sabi
model:    sabi-code
endpoint: http://127.0.0.1:8787/v1
```

`contextWindow: 1000000` and `maxTokens: 4096` are conservative metadata for
the current Sabi default route, not a claim about every upstream model. Images,
files, reasoning-effort switching, plan entitlement, cost, quality, and model
availability remain unknown until a matching DSH/Sabi live probe records them.

## Install

Prerequisites:

1. Install a compatible DSH runtime and make `dsh` available on `PATH`.
2. Run a Sabi OpenAI-compatible proxy on the loopback endpoint above. From the
   Sabi checkout, the current development command is `npm start`; use the
   product's user-level installation path when that package is released.

Install the bundle into a DSH profile:

```bash
dsh plugin --profile sabi add @vizuh/sabi-deepseek-harness
dsh --profile sabi --dump-config
```

Start the profile with DSH's normal command and select provider `sabi`, model
`sabi-code`. Surfaces that combine the two names may display this as
`sabi/sabi-code`. The bundle does not make Sabi the default model automatically.

To use another local Sabi endpoint without editing the installed package:

```bash
SABI_DSH_BASE_URL=http://127.0.0.1:8787/v1 dsh --profile sabi
```

The static bearer value in the bundle is a non-secret local placeholder. Sabi's
upstream credentials remain in Sabi configuration/environment and are never
copied into DSH settings, logs, profiles, or worktrees.

## Rollback

Remove the bundle from the profile and choose the previous DSH provider:

```bash
dsh plugin --profile sabi remove @vizuh/sabi-deepseek-harness
```

This only changes that DSH profile. It does not stop Sabi, delete provider
credentials, or change another harness.

## Evidence status

The package contract and patch are tested in the Sabi repository. A local DSH
binary was not installed for the initial publication gate, so a successful
`dsh` boot, model request, stream receipt, and end-to-end routing result remain
unverified. Do not describe this package as live DSH support until that bounded
probe is run against a pinned DSH runtime and a non-paid/mock Sabi upstream.
