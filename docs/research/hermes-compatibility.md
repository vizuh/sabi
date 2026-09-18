# Hermes compatibility

Checked 2026-09-18. **Hermes CLI → Sabi → local mock passed; full Hermes/Sabi support
is not certified.** The metadata bridge and an isolated Hermes → Sabi → mock probe are implemented. Native model/effort routing stays gated. No Python policy copy, provider
rebinding, planner API, tool wrapper, or second agent loop was added.

## Version and installation

- Source: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent/tree/01382698fc32ec7740b6a204d9b7a6abeac74d33),
  pinned commit `01382698fc32ec7740b6a204d9b7a6abeac74d33`.
- Isolated native `hermes --version`: **Hermes Agent v0.21.3 (2026.9.14)**,
  commit `01382698`, CPython **3.13.13**, OpenAI SDK **2.24.0**.
- `uv sync --frozen --no-dev --python 3.13` (uv **0.11.14**) installed
  **64 packages**, including the editable checkout, under `.sabi/compat/hermes/env`.
  `pyproject.toml` and `setup.py` were inspected first. No shell installer,
  extras, global install, login, paid inference, or upstream test suite ran.
- The checkout, interpreter, cache, isolated profiles and synthetic captures
  stay under ignored `.sabi/compat/hermes/`. `HOME` and XDG paths were isolated.
  Native probes used `bwrap` with an isolated network namespace and masked
  `/home`; only project packages, workspace dependencies and the runtime directory
  were visible there. The Sabi proxy fixture used system Node **22.23.1**.
  Telemetry collection and sending were explicitly disabled in the probe config.

## Bridge and config

[`packages/adapters/hermes`](../../packages/adapters/hermes/README.md) contains a
zero-dependency plugin and its focused tests. It adds `X-Sabi-Client: hermes`,
`X-Sabi-Session`, and `X-Sabi-Turn` only to the exact configured loopback
Chat Completions endpoint with model `sabi-code`. IDs come from middleware
context, not prompt content; absent/invalid IDs are omitted.

The callback copies the complete request and its header map. It preserves every
other provider kwarg, including tools, argument strings, ordering, reasoning
settings, stream options and unknown SDK objects. It registers only
`llm_request`. Middleware failure is fail-open, not a budget or permission stop.
Hermes' opaque `turn_id` spans a user turn and its tool requests; it is not a
per-inference request ID.

The [config template](../../packages/adapters/hermes/config.yaml.example) selects
`chat_completions`, manual alias registration and `discover_models: false`.
It disables Responses-native compaction and fallback providers. Context limits
must be filled by the operator; capability flags start false and need verification
across all eligible Sabi backends. No production limits, prices or model support
are invented. The placeholder key is local-only; real upstream credentials stay
with Sabi. Enable only in a new isolated profile; rollback disables this plugin
or selects the original profile, without deleting user state.

**Observed discovery limit:** `discover_models: false` does not stop every runtime
metadata probe in this version. With a mock that returns 404, two CLI invocations
made 14 GETs total across `/api/v1/models`, `/api/tags`, `/v1/props`, `/props`,
`/version`, `/v1/models`, and `/models`. The manual alias still reached
`/v1/chat/completions` and completed. With actual Sabi in front of the mock,
Hermes made 12 metadata GETs; Sabi's existing `/v1/models` route answered, and the
unsupported routes stayed 404. This is not proof of discovery suppression.
No Sabi endpoints were added to satisfy these probes.

## Verification

- **12 focused tests passed** in this adapter's zero-dependency uv project
  environment. They cover replacement preservation, unknown SDK objects, opaque
  ID boundaries, existing headers, safe scoping and stateless/idempotent behavior.
- Native CLI mock probe: fragmented streamed `read_file` call, final completion,
  then session resume completed in **3 Chat Completions requests**. The native
  file read used a synthetic text file. Its tool call ID and argument bytes
  survived into the next request and resumed history. Session identity remained
  stable; resume generated a new turn ID. No account data was read.
- Native probe exited **0**, `passed_with_metadata_probe_limit`. It recorded
  exactly **1 tool-use and 1 tool-result event**, four text deltas and two final
  results. It consumed synthetic SSE usage: 200 input / 40 output tokens for the
  tool turn, then 100 / 20 for resume. These are mock numbers, not paid usage or
  cost evidence. Earlier probes failed the broader discovery assertion; that
  limitation remains explicit, not recast as full support.
- **Hermes → actual Sabi → mock passed** in the same isolated namespace, with
  strict compatibility and Jev off. Shared core chose `mid → cheap → mid` across
  the three requests. All decisions had `outcome: ok`, `client: hermes` and
  `sessionKnown: true`: one hashed session, two hashed turns and three unique
  request IDs. No `X-Sabi-*` header or client placeholder authorization reached
  the upstream mock. The tool result, streamed text and usage survived the proxy.
- Pinned upstream worktree stayed clean. No installed-source patch was needed.

Artifacts under `.sabi/compat/hermes/`: `install.log`,
`metadata-project-tests.log`, direct-client baseline
`runs/20260918T133226072567Z/summary.json`, and proxy reports, including the final post-review run
`runs/20260918T140344697168Z/summary.json` with its `sabi.json`. The tracked
`probe_client.py --via-sabi` starts the real local `createSabiServer` through
`probe_sabi.mjs` with synthetic capability/config fixtures. No real model is contacted.

## Source evidence and remaining gates

Pinned-source references:
- [`agent/turn_api_request.py:139-149`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/turn_api_request.py#L139-L149):
  applies request middleware with session, turn, request, API mode and base URL.
- [`hermes_cli/middleware.py:76-91`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/hermes_cli/middleware.py#L76-L91):
  replacement payload and copy contract.
- [`agent/turn_api_call.py:84-135`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/turn_api_call.py#L84-L135):
  native streaming and execution middleware.
- [`hermes_cli/config_providers.py:484-550`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/hermes_cli/config_providers.py#L484-L550)
  and [`agent/models_dev.py:596-732`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/models_dev.py#L596-L732):
  route/model context and canonical capability overrides.
- [`agent/model_metadata.py:714-750`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/model_metadata.py#L714-L750)
  and [`1020-1078`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/model_metadata.py#L1020-L1078):
  local-server detection and live metadata GETs independent of picker discovery.

Covered surface: CLI main conversation and resumed main conversation. Title-model
upgrade was disabled; other auxiliary calls, compaction, subagents, MoA, gateway
and desktop were not exercised. No claim that they carry these headers.

Still gated: real-provider end-to-end behavior and paid smoke;
parallel tool calls, cancellation, disconnects, permission denial, retries/429,
images, cross-model tool history and compaction. Header-only tests do not prove
native model/effort changes reach the next inference. Any future routing bridge
must reuse shared `packages/core`, not reimplement policy in Python.
