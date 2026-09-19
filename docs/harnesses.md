# Harness compatibility

Status: 2026-09-18. A local mock test proves client/proxy compatibility, not model quality,
provider entitlement or savings. No paid provider smoke test has run in this implementation.

| Client | Evidence | Limit |
|---|---|---|
| OpenCode 1.18.30 | Real client → Sabi → mock; fragmented tool call, read result, mid → cheap. Also verified against the real proxy through a real profile: `npm run connect:opencode`, then a read tool round completed (2026-09-18) | No native model hook; only a read round has run against the real proxy, and paid smoke is blocked by provider credit |
| Kilo CLI 7.7.4 | Same real-client proxy flow, isolated npm install | Does not certify the VS Code extension |
| Prime Agent 0.9.5 | Strict Sabi → mock, three requests; parallel tools/IDs/usage preserved | Native setters affect the next user prompt, not continuing rounds |
| Hermes 0.21.3, pinned source | Native mock + metadata plugin; Hermes → Sabi → mock `mid → cheap → mid` | Extra capability-discovery GETs still occur; native routing not certified |
| Kilo VS Code | Source-reviewed custom-provider recipe | VS Code Flatpak exists here, but Kilo extension is absent; UI path untested |

## Shared setup

Use an explicit project/profile configuration. Do not replace normal provider defaults.
The existing Sabi service exposes `http://127.0.0.1:8787/v1/chat/completions` and `/v1/models`.
Clients use the **base** `http://127.0.0.1:8787/v1`, not the full completion URL.
Choose `sabi-code` for adaptive routing; fixed aliases preserve the selected tier.
Keep upstream keys in Sabi's environment. The proxy can load only configured references from the
existing environment, `SABI_SECRETS_FILE`, a nearest workspace `secrets/.env`, or the per-user Sabi
secrets file; it does not depend on Orca. A client that requires a key may use a non-secret local
placeholder. Host subscription credits and login tokens are not transferred to Sabi.

| Client | Configuration path |
|---|---|
| OpenCode | Custom provider using `@ai-sdk/openai-compatible`, `options.baseURL`, explicit alias and limits; `npm run connect:opencode` writes and preserves it; see [recipe](research/opencode-terminal-plan.md) |
| Kilo CLI | Project `kilo.jsonc`; `openai-compatible` provider, `options.baseURL`, model `openai-compatible/sabi-code` |
| Kilo VS Code | Custom provider → **OpenAI Compatible**, base URL above, manual alias; set tool/context/output metadata in `kilo.jsonc`, not guessed UI defaults |
| Prime Agent | Isolated custom `models.json` provider with `api: "openai-completions"`; see [tested limits](research/prime-agent-compatibility.md) |
| Hermes | Explicit `chat_completions` custom provider and metadata-only middleware; see [adapter](../packages/adapters/hermes/README.md) |

All aliases need conservative tool/modality/context/output metadata across the eligible
model set. Missing Kilo limits can disable compaction. Do not copy synthetic fixture limits
or model IDs into a production configuration. Host cost displays for adaptive aliases are
not authoritative; Sabi reports unknown usage/pricing as unknown, not free.

Some clients rewrite the commands they run before execution (RTK prefixes `rtk` and wraps with
`err`/`test`/`proxy`/`summary`). Sabi classifies a round partly from the command string, so it unwraps
a leading `rtk` before classifying: without that, RTK-rewritten reads and test runs fall to
`unclassified`, which changes tier and — on the proxy — buys a judge call per round. See
[RTK learnings](research/rtk-learnings.md).

## Strict compatibility

Existing configurations keep legacy behavior unless `compatibility.mode` is `strict`.
Legacy mode is not a proof of compatibility. Explicitly unsupported features still reject.
Strict mode requires each selected model to declare `contextWindow`, `maxOutputTokens`,
`capabilities` and `contextAccounting`. Capability fields include tools, parallel/strict
tools, input/output modalities, supported parameters, structured output and reasoning effort.
See `packages/core/src/types.ts` and the synthetic `compatibility.test.ts` fixtures.

Context accounting is an operator-supplied upper-bound assumption, not a tokenizer or
measured token count. Unknown required metadata rejects the route. Supply verified model
facts and justified bounds before production use; do not enable strict mode by inventing them.
A fixed alias never silently changes tier. Adaptive routing also does not guess a fallback
model when the selected backend is incompatible. Opaque reasoning/file/audio history can
require a fixed alias. Unsupported requests fail clearly instead of dropping fields.

## Identity, cancellation and privacy

Optional `X-Sabi-Client` accepts `hermes`, `opencode`, `kilo-cli`, `kilo-vscode`, `prime-agent`
or `unknown`. `X-Sabi-Session` and `X-Sabi-Turn` accept 1–128 ASCII token characters
(`[A-Za-z0-9._:-]`). Duplicate or invalid values return 400. Do not put content or keys here.
Identifiers are hashed before logging. Missing session IDs remain ungrouped/unknown;
never hardcode one session ID into a shared profile. These headers confer no permissions
and are not forwarded upstream. `X-Sabi-Request-Id` identifies the server request.

The model upstream gets one attempt, no redirects or automatic retry. The total request
budget defaults to 120 seconds (`SabiServerOptions.requestTimeoutMs`). The host owns its
retry policy; cancellation covers uploads, judgment, upstream fetch and streamed output.
Malformed/truncated streams fail rather than fabricate completion. Tools and arguments
remain unchanged on the wire. Unknown/MCP tool names are not treated as proven reads.

## Repeat the local checks

```bash
npm test
npm run typecheck
npm run eval
node packages/evals/src/client-smoke.ts opencode /absolute/path/to/opencode
node packages/evals/src/client-smoke.ts kilo-cli /absolute/path/to/kilo
```

The opt-in smoke runner creates an isolated HOME/profile and a synthetic fixture under
`.sabi/compat/`. It starts Sabi and a localhost mock, permits only the fixture read, checks
that the file is unchanged, bounds calls/time and records an allowlisted result summary.
It installs nothing and sends no paid inference. Success includes a real tool-result round
and a model change; a nonzero exit is not certification. The offline eval is frozen repricing,
not a live cost/quality benchmark. Client-specific probes remain separate from default tests.

## Rollback and remaining gates

Select the original provider and disable the explicit Sabi profile/plugin; keep files and
credentials intact. Do not bind a keyless Sabi endpoint publicly for containers/remote hosts.
Paid smoke needs an upstream key and approved spend cap. Kilo extension runtime validation
and provider-specific capability verification remain separate release gates. Native Prime
routing is deferred based on observed request behavior, not implemented through a workaround.
