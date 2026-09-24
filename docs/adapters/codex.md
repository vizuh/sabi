# Codex controller adapter

Codex is integrated through lifecycle and prompt hooks for task/session coordination. It is not
currently advertised as an in-session model/effort switcher.

## Hook events

sabi hooks install --codex writes Sabi-owned entries for:

- SessionStart (startup, resume, clear, compact)
- UserPromptSubmit
- SessionEnd

The installer preserves other Codex hooks, creates a .sabi-backup, and fails open when Sabi is unavailable.

~~~bash
npm run controller -- setup
npm run controller -- doctor
npm run controller -- hooks install --codex
~~~

A prompt can produce a controller plan with `CONTINUE`, `DELEGATE`, or `SPAWN` only when the
controller has a valid target and execution receipt. A receipt shows that a host accepted the
action; it does not prove that the downstream task completed successfully.

## Borrowed authentication

Codex can keep its own ChatGPT credential and still have Sabi choose the model per round: declare a
provider whose `base_url` is Sabi, with `wire_api = "responses"`, and Sabi accepts the Responses
format on `POST /v1/responses`, rewrites only `model`, and forwards it to the provider with the
credential Codex sent.

~~~toml
# ~/.codex/config.toml
[model_providers.sabi]
name = "Sabi (borrowed)"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"
~~~

Then select it for a run (`codex -c model_provider=sabi`), or set `model_provider = "sabi"` in the
file. Sabi needs the matching upstream and tiers:

~~~json
{
  "upstreams": { "openai": { "baseURL": "https://api.openai.com", "auth": "passthrough" } },
  "models": { "cheap": { "upstream": "openai", "model": "gpt-6-luna" },
              "mid": { "upstream": "openai", "model": "gpt-6-luna" },
              "strong": { "upstream": "openai", "model": "gpt-6-terra" } },
  "passthrough": { "alias": "sabi-code" }
}
~~~

Model ids above are the shape, not a claim about your plan. Sabi holds no key on this path, and the
Responses tool-item mapping is not implemented yet: only text items reach the classifier.

## Important boundary

The Codex hook does not switch the model in the current Codex session, bypass Codex approvals, or
transfer a Codex subscription to another provider. Use the Command Code mod or the local proxy
family when you need per-round inference routing.
