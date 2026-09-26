# Claude Code adapter

Claude Code has two integration surfaces, and they are different claims.

**Controller hooks** coordinate sessions: Sabi observes prompt/session events and can continue,
delegate or spawn a bounded target with a typed receipt. This surface does not change the model
selected inside an already-running Claude Code turn.

**Borrowed authentication** can change which model serves a round. Point `ANTHROPIC_BASE_URL` at
Sabi and every round arrives in Anthropic's own Messages format with Claude Code's own credential
attached; Sabi decides the tier from trajectory evidence and forwards the request to Anthropic with
that credential, rewriting only `model`. Sabi holds no credential of its own on this path — it never
opens `~/.claude/.credentials.json`, writes nothing to disk, and sends the credential only to
Anthropic.

## Borrowed-authentication recipe

~~~bash
# Sabi serves the borrowed route on the same loopback port as the proxy.
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
~~~

The upstream must be declared as a borrowed one, so Sabi cannot accidentally use a key of its own.
`passthrough.models`/`passthrough.policy` give the borrowed round its own tier set, separate from
the top-level `models`/`policy` — which stay whatever they already are for every other
OpenAI-compatible harness (Hermes, OpenCode, Command Code) routing free models through the same
proxy. Skipping `passthrough.models` and pointing the top-level `cheap`/`mid`/`strong` at Anthropic
instead would repoint those harnesses' free routing too; it's rarely what you want on a shared
config.

~~~json
{
  "upstreams": {
    "anthropic": { "baseURL": "https://api.anthropic.com", "auth": "passthrough" },
    "openrouter": { "baseURL": "https://openrouter.ai/api/v1", "apiKey": "$OPENROUTER_API_KEY" }
  },
  "models": {
    "cheap": { "upstream": "openrouter", "model": "some/free-model:free" }
  },
  "aliases": { "sabi-code": "auto" },
  "policy": { "unclassified": "cheap" },
  "passthrough": {
    "alias": "sabi-code",
    "models": {
      "cheap": { "upstream": "anthropic", "model": "claude-haiku-4-5" },
      "mid": { "upstream": "anthropic", "model": "claude-sonnet-4-5" },
      "strong": { "upstream": "anthropic", "model": "claude-opus-4-1" }
    },
    "policy": { "unclassified": "cheap" }
  }
}
~~~

The top-level `openrouter` upstream and `models.cheap` above are a stand-in for whatever your free
routing already is — the point being illustrated is the `passthrough` overlay, not that specific
upstream. The model ids under `passthrough.models` are examples of the shape; they are not a claim
about what your subscription entitles you to. A tier the credential cannot serve is refused by
Anthropic and relayed as-is.
`passthrough.policy` is optional — omitted, it reuses the top-level `policy`'s rule names, so
`passthrough.models` only needs to declare the same tier names (`cheap`/`mid`/`strong`/…) the
existing policy already references.

`sabi doctor` reports whether this is actually wired: a `proxy` check (the port is reachable) and a
`passthrough` check (an adaptive alias resolves to an upstream declared `auth: passthrough`) — both
distinct from the `daemon`/`systemd unit` checks, which only cover the controller.

## What the hook does

sabi setup or sabi hooks install --claude adds a fail-open UserPromptSubmit command hook to
Claude's settings. The hook sends bounded prompt/session/worktree metadata to the loopback
controller. If the controller accepts a delegation or spawn decision with a typed receipt, the
hook tells Claude to stop the current turn and explains where Sabi sent it.

~~~bash
npm run controller -- setup
npm run controller -- doctor
npm run controller -- hooks install --claude
~~~

The installer preserves existing settings and creates a .sabi-backup. Uninstall restores the
backup or removes only Sabi-owned entries.

## Important boundary

The **hook** does not change the model selected inside an already-running Claude Code turn. The
**borrowed route** does, and that is the whole point of pointing `ANTHROPIC_BASE_URL` at Sabi: the
round arrives with Claude Code's own credential, Sabi picks the tier, and the request goes to
Anthropic with that credential.

Neither surface moves Claude's subscription credits into Sabi: Sabi never holds the credential, and
it never adds a second one. Neither grants permissions to a spawned target. The controller can
dispatch only what its configured host or Orca transport can prove with a receipt.

Read support in layers: hook installation, a borrowed round reaching Anthropic, and a live session
that completed on a subscription are three different claims. Do not treat an executable on PATH as
proof that Claude is integrated, and do not treat a configured base URL as proof that a round was
served by the model Sabi chose.
