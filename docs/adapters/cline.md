# Cline adapter

Cline (VS Code extension; the same OpenAI-compatible provider surface exists in the Cline CLI and
SDK) can point at Sabi's local proxy through its **OpenAI Compatible** provider. Sabi schedules the
model/provider per round behind the `sabi-code` alias; Cline keeps its own agent loop, tools, and
account.

## Configuration

In Cline settings (⚙):

| Setting | Value |
| --- | --- |
| API Provider | OpenAI Compatible |
| Base URL | `http://127.0.0.1:8787/v1` (the base URL, not the full completion path) |
| API Key | any non-secret placeholder, e.g. `sabi-local` |
| Model ID | `sabi-code` (adaptive) or a fixed alias: `sabi-cheap`, `sabi-mid`, `sabi-strong` |

The proxy is loopback-only and does not authenticate requests by design (see
[security](../security.md)); the placeholder key is required by Cline's UI and is never forwarded
upstream. Upstream credentials stay with Sabi's configured upstreams (BYOK); Cline's own provider
keys and subscriptions are not read, moved, or rebound.

Cline's **Verify** connection test sends a real completion request, so it produces one routed round
(and possible upstream spend) — it is not a free ping.

## Evidence boundary

- **Protocol-level fixture (in-repo, runs in `npm test`):**
  [cline-protocol.test.ts](../../packages/server/test/cline-protocol.test.ts) replays Cline's
  documented request contract — `POST {baseURL}/chat/completions`, `Authorization: Bearer`, OpenAI
  Chat Completions body with `model`/`messages`/`stream`/`tools`/`temperature`, SSE streaming —
  against the real Sabi proxy wired to two synthetic upstream lanes. It proves per-round routing
  across both lanes, client-visible alias stability, SSE termination with `[DONE]`, usage-bearing
  frames, and tool-schema passthrough.
- **Contract sources (read 2026-09-21, page-level, not commit-pinned):** Cline's published
  provider-config page for OpenAI Compatible, the Chat Completions API reference, and the SDK
  provider reference (`providerId: "openai-compatible"`, `baseUrl`, `apiKey`, `modelId`).
- **Not claimed:** no live run of the Cline extension or CLI against Sabi has been recorded. The
  fixture proves the wire contract, not extension behavior, plan entitlement, savings, or quality.
  Cline's own retry/fallback behavior is unchanged by this recipe.

## Relation to Cline's fallback-chain request (cline/cline#13711)

Sabi treats transport failures (429/quota/timeout) as a signal that is orthogonal to task
difficulty: a dedicated `transport` policy rule keeps rate-limited rounds on-tier instead of
escalating to a stronger model, and an opt-in transport fallback (`transportFallback.enabled`,
shipped off) retries cost-ordered alternate lanes on 429/402/403 for adaptive rounds only. This
separation — provider/transport state versus capability escalation — is the design input, not a
claim that Cline's requested per-turn fallback already works through Sabi.

See [harness compatibility](../harnesses.md) and the [adapter index](README.md).
