# Hermes × Sabi routing V1

Status: complete for the pinned Hermes main-conversation path, 2026-09-20.

## Goal

Make Hermes use Sabi without changing Hermes' agent loop. Hermes remains responsible
for tools, permissions, streaming, retries, cancellation and transcript ownership.
Sabi remains responsible for trajectory-aware inference scheduling.

## Supported path

```text
Hermes
  ↓ public llm_request middleware
custom:sabi / sabi-code
  ↓ OpenAI-compatible loopback request
Sabi proxy
  ↓ shared deterministic policy + optional Jev
configured upstream model/provider
```

The plugin is intentionally thin. It replaces only the request container and
Sabi-owned attribution headers. It never sends a second model request and never
copies Sabi policy into Python.

## Contract

1. Only `chat_completions`, `hermes.middleware.v1`, model `sabi-code` and the
   exact configured loopback `/v1` base are eligible.
2. `X-Sabi-Client`, `X-Sabi-Session` and `X-Sabi-Turn` contain only validated
   opaque IDs. Invalid or missing IDs are omitted; prompt text never becomes an
   identity.
3. Hermes' `turn_id` groups a user turn and its tool-loop requests. Sabi creates
   a separate request ID for each inference request and routes from the evolving
   request state.
4. Explicit Hermes provider/model choices remain outside the adapter. The
   adapter does not rebind a subscription or provider connection.
5. Sabi and Hermes fail open: middleware mismatch, unsafe endpoint, malformed
   headers or unavailable Sabi metadata leaves the request untouched.
6. Raw prompts, tool results, credentials and upstream authorization do not enter
   the adapter's persistent evidence. Sabi's existing allowlisted telemetry rules
   remain authoritative.
7. Hermes owns compaction and handoff text. Jev is not allowed to delete or
   rewrite the Hermes transcript in this V1. Cross-session controller handoffs
   remain a separate Sabi controller contract.

## Acceptance evidence

The V1 is complete when all of these pass from a clean worktree:

- adapter unit tests preserve every unknown request field and reject unsafe scope;
- the pinned native Hermes mock completes one file-tool loop and a resumed turn;
- Hermes → Sabi → mock records three unique request receipts, one hashed session,
  two hashed turns, `client: hermes`, and `outcome: ok` for every request;
- the shared fixture routes `mid → cheap → mid` without losing tool IDs,
  arguments, results or streamed completion;
- Sabi metadata and client placeholder authorization are stripped before the
  upstream mock;
- metadata discovery that Hermes performs despite `discover_models: false` is
  tolerated and reported, not hidden or falsely claimed suppressed;
- no paid provider, user profile or secret is required for the acceptance run.

## Explicit non-goals

These are not blockers for this V1 and must not be implemented by duplicating the
Hermes loop:

- changing a native Hermes subscription's provider from middleware;
- routing title, subagent, MoA, desktop or gateway calls without separate evidence;
- replacing Hermes' `ContextEngine` or destructive transcript compaction;
- treating catalog visibility as plan entitlement or cost proof;
- claiming model quality, savings or paid-provider health from the synthetic probe.

The next gate for any of those surfaces is a pinned runtime contract plus a separate
read-only/mock acceptance test.
