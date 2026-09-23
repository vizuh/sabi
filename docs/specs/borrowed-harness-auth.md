# Borrowed harness authentication

Status: design accepted by the operator 2026-09-23; not implemented. Slice 1 is named at the end.

## Contract

Sabi sits between the harness and the model. It decides which model and upstream serve each round.
It does not hold, copy or store a provider credential: the harness keeps its own credential and
keeps sending it, and Sabi forwards the request — with the credential it received, unchanged — to
the provider that credential belongs to.

```text
harness (already authenticated)          Sabi (local, loopback)            provider
  request + its own credential  ───────▶  classify round, choose tier  ───▶  same credential,
                                          rewrite model id only                same provider
        ◀───────────────────────────────  stream back byte-for-byte  ◀──────
```

The credential is not read from a file. It arrives on a request the harness already authenticated,
is used for that one outbound call, and is never written to disk, never logged, and never sent
anywhere except its own provider.

## Why this is not "Sabi reads your keys"

- No credential file is opened — not `~/.claude/.credentials.json`, not `~/.codex/auth.json`, not
  the OMP credential store. The evidence for slice 1 is a test asserting Sabi performs no read of
  any harness credential path.
- The only outbound destination is the provider the harness would have called itself. The egress
  boundary is unchanged; the *decision* boundary is what moves.
- Nothing is persisted: a forwarded credential lives for the duration of one request.

## Mechanism per harness

Each harness already supports pointing a provider at a local base URL while keeping its own
credential. Verified for the first target:

| Harness | How it is repointed | Credential |
| --- | --- | --- |
| Oh My Pi | `pi.registerProvider("<provider>", { baseUrl })` — documented as an override for an existing provider | resolved by OMP's own AuthStorage, independent of `baseUrl` |
| Claude Code | `ANTHROPIC_BASE_URL` | its own subscription or key, sent per request |
| Codex | `model_providers.<id>.base_url` with `wire_api` | its own ChatGPT or key auth |

## What Sabi has to add

Today's server speaks OpenAI chat-completions in both directions. A pass-through needs the
harness's native wire format on the way in and the same format out:

- `POST /v1/messages` (Anthropic Messages) accepted, routed, forwarded verbatim to the Anthropic
  upstream with **only** the `model` field rewritten to the chosen tier.
- The same for Codex's Responses wire format.
- Header forwarding for the provider's own protocol headers: `authorization`, `x-api-key`,
  `anthropic-version`, `anthropic-beta`, `openai-beta`, `session_id`.
- Streaming forwarded frame-by-frame. Sabi's existing SSE tap observes usage and the served model;
  it must not rewrite frames on this route.
- The round classifier reads the harness's message shape rather than only OpenAI's, so the tier
  decision works on a native request.

## What "strong" means here

Escalating inside the harness's own subscription: a round classified `failure` or `stuck` is served
by a stronger model the same credential can reach, rather than by delegating the whole task to
another harness. Delegation stays available at the hook boundary; it is not what this route does.

The tier table therefore maps to model ids the borrowed credential can serve, per upstream. A tier
whose model the incoming credential cannot serve is not a routing failure to hide — it is refused
with a clear error, because Sabi cannot know an entitlement it was not given.

## Boundaries, and the lines this supersedes

This changes two documented statements, which are updated in the same change that implements it:

- `docs/adapters/claude-code.md`: "integrated at the controller boundary, not as a native
  per-round model router" — true of the hook-only adapter, no longer the whole story.
- `AGENTS.md`: "do not switch paid subscriptions or harness-selected models" — superseded: Sabi may
  choose which model inside a subscription serves a round. It still does not change *entitlement*,
  add a second credential, or spend money the harness was not already entitled to spend.

## Slices

1. **Anthropic pass-through for one harness.** `POST /v1/messages` routed and forwarded to
   `api.anthropic.com` with the incoming credential; per-round model choice among models that
   credential can serve. Acceptance: Claude Code with `ANTHROPIC_BASE_URL` pointed at Sabi runs a
   real session; the decision log shows tier → model per round; a test asserts no harness
   credential path is read; the request body is forwarded unchanged apart from `model`.
2. **Responses pass-through for Codex**, same contract, `wire_api` on the Codex side.
3. **OMP provider override** added to the existing adapter extension, so a built-in provider can be
   pointed at Sabi with one line.
4. **Cross-provider borrowing** — serving a Claude Code round from a different provider's plan
   (for example Zen Go) — is explicitly out of scope: it needs a second credential, which is the
   thing this design exists to avoid.

## Risks

- Provider terms may not permit a local proxy rewriting model ids on a subscription credential.
  Operator-accepted; the requests are the harness's own and stay on the machine until the provider
  call.
- The harness's own cost and quota accounting will not match what Sabi chose. Sabi's decision log
  becomes the record of what actually served each round.
- A harness that caches provider model metadata may keep showing the model it thinks it selected.
