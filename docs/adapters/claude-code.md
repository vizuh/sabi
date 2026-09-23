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

The upstream must be declared as a borrowed one, so Sabi cannot accidentally use a key of its own:

~~~json
{
  "upstreams": { "anthropic": { "baseURL": "https://api.anthropic.com", "auth": "passthrough" } },
  "models": {
    "cheap": { "upstream": "anthropic", "model": "claude-haiku-4-5" },
    "mid": { "upstream": "anthropic", "model": "claude-sonnet-4-5" },
    "strong": { "upstream": "anthropic", "model": "claude-opus-4-1" }
  },
  "aliases": { "sabi-code": "auto" },
  "passthrough": { "alias": "sabi-code" }
}
~~~

The model ids above are examples of the shape; they are not a claim about what your subscription
entitles you to. A tier the credential cannot serve is refused by Anthropic and relayed as-is.

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
