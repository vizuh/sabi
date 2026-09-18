# Harness support evidence

Checked 2026-09-18 for the [multi-harness plan](multi-harness-plan.md). Static evidence,
not end-to-end certification. No account configs/credentials read, clients installed,
services started or inference requests sent. Hermes and Kilo are not on this host's PATH.

## Sabi snapshot

Local HEAD: `1485cdedff1d0daf5778d6009c3d0f24e55b46cc`.
- `packages/server/src/server.ts:152-175`: Chat Completions, model listing and local
  health/decisions routes. No Responses or Anthropic Messages route in this handler.
- `packages/server/src/upstream.ts:13-26,38-51`: swap model, optionally request stream
  usage, then forward Chat Completions with Sabi's configured upstream credentials.
  Request passthrough is not model-capability or reasoning-parameter normalization.
- `packages/core/src/log.ts:21-26`: session IDs hash truncated first system/user text.
  This is not reliable attribution across clients, concurrent tasks or compaction.
- `packages/core/src/harness.ts` and `router.ts` share `decideTier`; only Command Code
  has an adapter package. Existing evals are not tests of the four requested harnesses.
- Drift: older docs call implemented packages “planned”; test counts/live claims refer
  to earlier sessions. This review does not rerun or independently endorse those claims.

## OpenCode: proxy first, native model hook not established

Installed `opencode --version`: **1.18.30**. `opencode run --help` exposes `--pure`,
`--model provider/model`, JSON output and explicit permission warnings for `--auto`.
Only version/help ran. Existing [provider research](opencode-terminal-plan.md) records
custom `@ai-sdk/openai-compatible`, `options.baseURL`, explicit model entries and limits.
No config was applied; real-client mock validation remains a release gate.

Local `~/.opencode/node_modules/@opencode-ai/plugin` is **1.18.4**, not the CLI version.
Its `dist/index.d.ts:203-224` exposes parameter and header hooks (including `sessionID`),
but no explicit model replacement output there. SHA-256:
`f3ec1a150d1354be3c9d93928fa130edc118c63fb468533ebb01eb3d6ed77f92`.
Do not install this mismatched plugin as proof of native per-round routing. After version
alignment, header/event hooks are candidates for richer attribution, not permission grants.

## Prime Agent: custom provider documented; native timing needs proof

Installed executable resolves to release **0.9.5**, archive identifier
`bc4b0ed791d1e8b3b5d6a95249a60306d9579fc0d6038e5d7d82f068d81f008d`
under `~/.local/share/prime-agent/releases/`. Archive not downloaded/rehashed. The following
paths are shipped files in that release, not verification of every runtime behavior:
- `docs/models.md:19-39,121-140`: custom `models.json` provider with `baseUrl`,
  `api: "openai-completions"`, explicit models and API key. A local placeholder is documented;
  no real upstream key belongs in the Sabi client entry. Limits/input/reasoning metadata
  appear at `67-85`; compatibility flags for developer role/effort appear at `39-60`.
- `docs/extensions.md:275-300,549-560,1558-1579`: per-turn events, provider request hooks,
  `pi.setModel` and `pi.setThinkingLevel` are documented. The chosen provider/stream behavior
  in an active parent turn was not verified. A setter's existence is not a timing guarantee.
- Source identity: `docs/models.md` SHA-256
  `559dafacb9953ad1a027a1fd886ca7e8fb7323dcb83f0e4a76fef1b806d55d55`;
  `docs/extensions.md` SHA-256
  `11cd2a98c020a672ac5e5e98637de27e6c004c4294ef0c57f451b046c9454a3d`.
- The packaged manifest points to `dist` exports, but this standalone release has no
  `dist` source directory. Do not infer source-level runtime verification from those docs.
  [Earlier Prime review](prime-agent-reuse.md) verified Python child spawning; that still
  does not establish a parent-round scheduler. No credentials or settings were inspected.

## Hermes: explicit Chat mode; native request middleware is a candidate

[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent/tree/01382698fc32ec7740b6a204d9b7a6abeac74d33)
at `01382698fc32ec7740b6a204d9b7a6abeac74d33` (commit 2026-09-18). Not installed/tested here.
- `website/docs/user-guide/configuring-models.md:127-138,181-242`: main-model `base_url`
  and `api_mode: chat_completions`; custom `providers.<name>.api` is the endpoint URL,
  not Prime's protocol selector. Explicit models/discovery-off and route-specific context/
  caching capabilities are documented. Keep native provider compaction off for Sabi's
  Chat-only endpoint; do not infer caching/vision/reasoning capability from the alias.
- `website/docs/developer-guide/middleware.md:30-55,90-103`: general plugins register
  `llm_request` middleware per provider request and return a complete replacement request.
  It has session/task/turn/request IDs and can alter model/provider-format request settings.
  `agent/turn_api_call.py:84-95,119-135` invokes execution middleware around native calls.
- The middleware's fail-open contract (`middleware.md:79-86,249-265`) means an exception
  is not a budget/permission stop. Do not add a second retry loop or wrap tool execution.
  Keep host controls intact and verify no configured fallback bypasses Sabi.
- Model rewriting does not prove client/provider rebinding, refreshed capability metadata,
  or safe cross-protocol continuation. Scope any native trial to verified compatible models.
  Proxy correlation headers and coverage of auxiliary/subagent calls remain unverified.

## Kilo: test CLI and VS Code as separate surfaces

[Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode/tree/5a0377688fcfef6a073ce0a96e5db13b699b2853)
at `5a0377688fcfef6a073ce0a96e5db13b699b2853` (2026-09-18). Source manifests (not installed builds):
`packages/opencode/package.json:3-4` and `packages/kilo-vscode/package.json:2-15` both
report **7.7.4**. Test actual installed builds before claiming compatibility.
- `packages/kilo-docs/pages/code-with-ai/agents/custom-models.md:21-45,226-252`: VS Code
  custom provider → **OpenAI Compatible**; CLI → `openai-compatible` provider with
  `options.baseURL` and explicit alias. Both use the `/v1` base, not a completion URL.
  Manual model registration avoids depending on discovery. Do not select Responses.
- That document's `78-98,135-152` requires explicit tool/capability/context/output metadata.
  It warns unknown custom limits can default to zero and disable compaction. Use verified
  conservative limits across eligible targets, not copied example numbers or fake prices.
- `packages/kilo-vscode/src/shared/custom-provider.ts:29-58` confirms custom provider
  base URL, headers and models. More model limits/options need the documented config file.
- `packages/llm/src/protocols/openai-compatible-chat.ts:10-22` declares Chat Completions
  with SSE; `packages/plugin/src/index.ts:244-260` exposes parameter/header hooks, not
  an explicit selected-model output. Plugin loading/round invocation was not verified.
- Do not assume API parity with OpenCode or target the archived `Kilo-Org/kilo` repository.
  Actual installed-version paths, headers, cancellation, tools and Sabi compatibility need
  separate client tests. No Kilo config or extension settings were inspected/changed.
