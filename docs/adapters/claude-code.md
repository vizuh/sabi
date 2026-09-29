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

## Task brief: prepare on free inference, execute in Claude

`sabi brief "<task>" --preparer=hermes|omp|pi|prime` hands the exploration part of a task to a
cheaper model running in another harness, then writes a brief for a fresh Claude Code session
(spec 018). Add `--spawn` to start Claude on it directly.

- The preparer runs in a disposable clone of the repository with no remote, through Sabi's proxy
  (`--proxy`, default `http://127.0.0.1:8787/v1`; `--alias`, default `sabi-code`; OMP always uses
  `sabi-code`, the only model its Sabi extension registers). Sabi runs no commands of its own; it
  fingerprints the repository before and after and refuses the brief if anything changed.
- The preparer is sandboxed with bubblewrap by default (`--sandbox=bwrap`). What that guarantees:
  - **Only what it needs exists.** The filesystem inside is an allowlist: read-only system
    directories (`/usr`, `/etc`, `/opt`, `/sys`, `/nix/store` if present), the install roots of
    the commands it runs (for example `~/.nvm`, `~/.bun`, `~/.local/bin`,
    `~/.local/share/<tool>`), and a writable scratch directory holding its clone, generated
    config, HOME, TMPDIR and runtime dir. There is no `/run`, no rest of HOME and no user
    repository inside, so credential stores, sockets on disk (D-Bus, systemd-resolved, other
    daemons) and other checkouts are unreachable by path.
  - **Only Sabi is reachable.** The sandbox has its own network namespace; a relay forwards one
    loopback port to the local Sabi proxy, so Sabi's controller daemon, Ollama and every other
    local service are unreachable. `--proxy` must therefore be a loopback URL.
  - **No signalling or typing into host processes:** new PID namespace and session. Its
    environment is an allowlist without provider keys or tokens.
  - **Limit:** the mounted install roots are readable. Anything the preparer can read can reach
    the model through Sabi.
  When a harness lives somewhere automatic detection cannot see (for example a wrapper script
  that execs a virtualenv elsewhere), list extra read-only paths in `SABI_SANDBOX_RO`
  (colon-separated). Without a working bubblewrap the command refuses; `--sandbox=none` runs the
  preparer unsandboxed and must be chosen explicitly.
- Facts are verified by reading: each quoted file span must exist in your working tree. Command
  results are kept as reported by the preparer and labelled as not re-run. Hypotheses stay
  hypotheses.
- Briefs, receipts and the preparer's output live under `~/.config/sabi/briefs/<id>/`
  (`SABI_BRIEFS_DIR` overrides). Nothing is written inside the repository.
- If preparation fails, the receipt says why and `--spawn` still starts Claude with the plain task.
- The `sabi-prep` skill (`skills/sabi-prep/SKILL.md`) lets Claude run this itself.

A brief pays off on tasks whose exploration is expensive. On a three-file fixture (2026-09-29) the
briefed Claude session used more turns than a cold one (10 vs 6); larger tasks are not measured yet.

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
