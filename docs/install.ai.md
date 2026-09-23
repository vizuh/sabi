# Host-AI installation flow

**English** · [Português (BR)](install.ai.pt-BR.md)

This is the canonical flow for a user who asks Command Code, OpenCode, Hermes,
Claude Code or Codex to install Sabi. The host AI should execute it step by step,
answer in the user's language, and never guess a harness, account or model plan.

Suggested user request:

> Install Sabi for this harness. Follow `docs/install.ai.md`, ask the required
> questions in my language, use OpenRouter as the only proxy credential, explain
> what Sabi does if I opt in, then start the supported path and show the checks.

## Questions, in this order

1. Detect the language from the conversation and ask only when it is ambiguous.
2. Detect the installed harness, then confirm: Command Code, OpenCode, Hermes,
   Claude Code or Codex.
3. Ask which route is wanted:
   - native host route when the harness has one;
   - OpenRouter-backed Sabi proxy when the user wants Sabi to choose the model/provider
     for each compatible inference round.
4. Ask for one credential only when the proxy route is selected:
   `OPENROUTER_API_KEY`. Never ask Sabi for an OpenAI, Anthropic, Nous, ChatGPT
   Plus or OpenCode Go password/key. Those logins remain in their host, or can be
   configured as BYOK inside OpenRouter.
5. Ask whether to show a short explanation. `--explain=local` is free and local;
   `--explain=ai` makes one explicit OpenRouter request and may spend credit.
6. Before changing a host config, state the exact files and command, then obtain
   the user's confirmation. Preserve existing providers and use the Sabi backup.

The AI must not paste a secret into chat, shell history, a config JSON, a prompt,
or a log. On a TTY the setup wizard asks for the OpenRouter key with hidden input
and stores it in the user-scoped secrets file with mode `0600`.

## Install command

For Claude Code, Codex and controller-backed OpenCode workflows, install the published
controller first:

~~~bash
npm install --global @vizuh/sabi-controller@0.1.0
sabi setup
sabi doctor
~~~

For Hermes or OpenCode inference through the local Sabi proxy, use a Sabi checkout because the
controller package contains hooks and the daemon, not the proxy server or Hermes profile:

~~~bash
git clone https://github.com/vizuh/sabi
cd sabi
npm install
~~~

The host AI should use the command matching the confirmed harness:

| Harness | First action | Credential asked by Sabi |
|---|---|---|
| Command Code | `cmd mods add -g npm:@vizuh/sabi-commandcode@0.1.3` | none for the native mod |
| OpenCode | `npm run setup -- --harness=opencode --no-jev` | OpenRouter only |
| Hermes | `npm run setup -- --harness=hermes --upstream=openrouter --hermes-home="$HOME/.config/sabi/hermes" --no-jev` | OpenRouter only |
| Claude Code | `sabi setup` | none for the controller hook |
| Codex | `sabi setup` | none for the controller hook |

For a native Command Code setup, Sabi uses the Command Code subscription and the
local mod; it does not need the proxy or an OpenRouter key. The proxy class is a
separate, paid-upstream choice and must be explicit.

For OpenCode or Hermes, configure the key before starting the proxy. The wizard
can collect it interactively; in an agent-driven non-TTY run, set it through the
environment or `SABI_SECRETS_FILE` through the host's secret manager without
printing it. Never put the literal value in a command shown to the user.

Then start the local proxy and the host:

~~~bash
npm start                                      # 127.0.0.1:8787
opencode run --model sabi/sabi-code "your task"
~~~

Hermes uses its native loop and the generated `custom:sabi` profile:

~~~bash
SABI_CONFIG="$HOME/.config/sabi/hermes/sabi.config.json" npm start
HERMES_HOME="$HOME/.config/sabi/hermes" hermes chat
~~~

The Hermes `--upstream=hermes-nous` option remains available when the user wants
the isolated Hermes Nous proxy instead. OpenCode Go and ChatGPT Plus remain native
Hermes providers selected with `hermes model`; Sabi does not transfer those plans
into its proxy.

Claude Code and Codex receive controller hooks for task/session routing.
That is a supported host integration, not an in-session model switch and not a
subscription transfer. Run `sabi doctor` and report that boundary instead of
claiming `sabi-code` is active inside their native turn.

## OpenRouter BYOK recommendation

Sabi needs only the OpenRouter API key on the local machine. Add provider keys in
OpenRouter's BYOK settings and choose their prioritized/fallback behavior there.
OpenRouter documents that prioritized BYOK keys are attempted before shared
capacity, while fallback keys are tried after shared capacity; the Sabi config
does not need to contain those provider credentials:
[OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok).

Start with a spending limit on the OpenRouter key and use the generated
`sabi-code` alias. Keep `sabi-cheap`, `sabi-mid` and `sabi-strong` for explicit
baselines; their model ids and account entitlement still need verification.

## Completion checks

The host AI must report each layer separately:

- files changed and backups created;
- `sabi.config.json` validates;
- `curl -fsS http://127.0.0.1:8787/healthz` succeeds for the proxy path;
- the host starts with the intended Sabi alias/profile;
- a bounded smoke task completes and appears in `.sabi/decisions.jsonl`;
- native subscription/login behavior was preserved.

A generated config, an installed hook, or a successful health check alone is not
proof that a paid inference round completed. If any check is unavailable, say so.
