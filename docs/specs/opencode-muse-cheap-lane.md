# OpenCode Muse cheap lane

Status: phase 0 implemented; native Muse action routing proposed, 2026-09-20.

## Problem

The installed OpenCode profile currently exposes `sabi/sabi-code` with a safe 1,000,000-token
context limit but only a conservative 4,096-token output limit. The 4,096 value comes from the
OpenCode writer's fallback when a reachable Sabi tier has no declared `maxOutputTokens`; it is not
the model context window.

OpenCode 1.18.31's local catalog exposes `opencode/muse-spark-1.3-contributor-free` with a
1,048,576-token context limit, 131,072-token output limit and tool calls. OpenCode Zen documents
that model on `/responses` using `@ai-sdk/openai`, and marks the contributor-free offer as temporary:
[Zen model list](https://opencode.ai/docs/zen). This is runtime/catalog evidence, not a durable
entitlement or quality guarantee.

## Decision

1. **Close the real metadata gap now.** The proxy tiers declare verified output ceilings of
   943,718 (cheap), 128,000 (mid) and 128,000 (strong), so the adaptive alias advertises the
   minimum safe output ceiling: 128,000. Context remains the minimum eligible tier window.
2. **Do not put `opencode/...` in `sabi.config.json`.** The current proxy always sends
   `POST .../chat/completions` (`packages/server/src/upstream.ts`); Muse's documented route is
   `/responses`. The proxy also has no access to OpenCode's native session credential. A config-only
   `opencode-zen` upstream would be an unverified protocol/auth failure, not a working cheap tier.
3. **Keep `small_model` separate.** OpenCode's top-level `small_model` is for utility work such as
   titles/summaries; it does not give Sabi a per-round model hook. The connector now supports the
   explicit opt-in `--small-model=provider/model`; setting it to native Muse makes Muse a host utility
   model, while `model=sabi/sabi-code` remains the Sabi coding/tool route.
4. **If native Muse must serve coding rounds, add a separate protocol lane first.** It needs an
   explicit Responses upstream contract, credential reference, tool/stream/usage translation,
   context-fit checks and safe cross-model reasoning handling. Native OpenCode hooks are not a
   substitute until the installed runtime proves a supported per-round model replacement surface.

## Acceptance

- `npm run connect:opencode` advertises `sabi-code.limit.output = 128000` from the shipped config;
  `sabi-code.limit.context` remains `1000000`.
- `npm run connect:opencode -- --set-default --small-model=opencode/muse-spark-1.3-contributor-free`
  sets only OpenCode's utility model and leaves the adaptive main model on `sabi/sabi-code`.
- No Sabi proxy request is sent to an OpenCode-native model until a Responses-capable upstream and
  explicit credential path are implemented and tested.
- A native Muse smoke, if separately approved, proves only model availability/tool compatibility;
  it does not prove Sabi routing, task success, quota, cost or Jev health.
- A future action-lane pilot must pass mock non-stream/stream/tool/usage/error tests and a bounded
  read-only live check before changing the cheap policy tier.

## Kill criteria

- Muse is absent, unavailable, rate-limited or returns a protocol/auth error: remove it from the
  eligible action set and keep the existing Sabi route.
- Switching from Muse to another model replays provider-bound encrypted reasoning state or fails to
  preserve tool calls: do not use Muse as an action tier; keep it utility-only.
- OpenCode exposes no supported per-round replacement hook and Sabi has no Responses bridge: this
  issue remains a documented integration boundary, not a reason to fork OpenCode.
