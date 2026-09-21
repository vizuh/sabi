# Hermes adapter

**English** · [Português (BR)](hermes.pt-BR.md)

Sabi integrates with Hermes through its supported llm_request middleware seam and an explicit
Chat Completions custom provider.

The supported V1 path is:

~~~text
Hermes → custom:sabi / sabi-code → Sabi proxy → configured upstream
~~~

Hermes keeps the native loop. The middleware adds attribution headers and preserves the complete
request, including tools, IDs, order, arguments, and SDK objects. It does not create a second retry
loop or policy implementation.

## Current status

- Pinned/tested against Hermes 0.21.3 at commit 01382698fc32ec7740b6a204d9b7a6abeac74d33.
- Native mock and Sabi-proxy probes cover a bounded tool loop and resume.
- Extra model-discovery requests, auxiliary paths, subagents, and paid-provider smoke tests remain
  separate gates.
- A fail-open middleware is not a budget or permission enforcement boundary.

## Start

For an end-user Hermes profile, use the setup wizard. In Orca, open three terminal tabs on this
worktree and run the marked blocks in separate tabs:

~~~bash
npm run setup -- --harness=hermes --hermes-home="$HOME/.config/sabi/hermes" --no-jev
export HERMES_HOME="$HOME/.config/sabi/hermes"
hermes auth add nous --type oauth

# Terminal 1
HERMES_HOME="$HERMES_HOME" hermes proxy start --provider nous --host 127.0.0.1 --port 8645

# Terminal 2
SABI_CONFIG="$HERMES_HOME/sabi.config.json" npm start

# Terminal 3
export SABI_HERMES_BASE_URL="http://127.0.0.1:8787/v1"
HERMES_HOME="$HERMES_HOME" SABI_HERMES_BASE_URL="$SABI_HERMES_BASE_URL" hermes chat
~~~

For a single-key OpenRouter setup, replace the first command with:

~~~bash
npm run setup -- --harness=hermes --upstream=openrouter \
  --hermes-home="$HOME/.config/sabi/hermes" --no-jev
~~~

The OpenRouter profile does not run `hermes proxy` or ask for a Nous login. It uses only
`OPENROUTER_API_KEY`; provider BYOK, priority and fallback remain configured in OpenRouter.
Use `--explain=local` for a free localized explanation, or `--explain=ai` for one explicit
OpenRouter explanation request.

For that mode, skip the Nous login and proxy lines above and use two terminals:

~~~bash
SABI_CONFIG="$HOME/.config/sabi/hermes/sabi.config.json" npm start
HERMES_HOME="$HOME/.config/sabi/hermes" hermes chat
~~~

## Nous-first profile (free lane + paid fallback)

When the OpenRouter balance is dry, run Sabi on the Nous free lane first and keep
paid tiers as fallback. Copy
[`sabi.config.nous-free.json.example`](../../packages/adapters/hermes/sabi.config.nous-free.json.example)
to `$SABI_CONFIG`, then:

~~~bash
# Terminal 1 — Hermes holds its own Nous OAuth; Sabi never sees it.
hermes proxy start --provider nous --host 127.0.0.1 --port 8645

# Terminal 2
SABI_CONFIG="$SABI_CONFIG" npm start
~~~

`cheap` becomes `poolside/laguna-s-2.1:free` ($0, verified live 2026-09-21) and
`transportFallback` retries 429/402/403 adaptive rounds cost-ordered, so `sabi-code`
answers free instead of dying on an exhausted key. Mid/strong stay OpenRouter and
resume automatically once funded. Verified the same day: fixed-alias, adaptive,
streamed and Hermes `--provider custom:sabi -m sabi-code` rounds all `ok` via Nous.

The wizard creates an isolated `HERMES_HOME`, copies the plugin, and writes a
Nous-backed or OpenRouter-backed Sabi config according to `--upstream`. Read the detailed [Hermes adapter README](../../packages/adapters/hermes/README.md)
before changing the profile. The target directory must be new or empty; keep an existing
personal `.hermes`/Hermes profile untouched.

The exact loopback base must be present in `SABI_HERMES_BASE_URL`; the plugin fails open for
another host or an unrecognised endpoint. On this host, `qwen2.5-coder:7b` has a 32768-token
context and Hermes 0.21.3 requires at least 64000 for a custom model. Use Nous or a local model
with a verified context of at least 64000 for the Hermes path; Qwen remains available through a
direct Sabi/Ollama path.

## Recommended: native default, Sabi per run

Keep the Hermes default on a native Nous model and reach for Sabi explicitly per run:

~~~bash
# Everyday use: native Nous free lane, no proxy, no key.
hermes -z "your task"

# Opt-in routing (needs the Sabi proxy up and a funded upstream):
hermes --provider custom:sabi -m sabi-code -z "your task"
~~~

This is the fail-open posture: when the OpenRouter balance behind the proxy is exhausted,
native sessions keep working and only `sabi-code` rounds fail. Verified 2026-09-21 against
Hermes 0.21.3: the default `sabi-code` leaked to Nous Portal (`HTTP 404: Model 'sabi-code'
not found`); after switching the default to `poolside/laguna-s-2.1:free` a trivial prompt
answered with no Sabi decision row (direct native).

Two Hermes-specific gotchas, both verified the same day:

- The custom lane needs the full provider block (`providers.sabi`, `model_overrides`,
  as in `config.sabi.yaml.example`). A bare `model.base_url` with `provider: nous`
  does not route — the model name leaks to Nous and 404s. That degraded shape was
  the live breakage; repairing the block is what lets `custom:sabi` reach the proxy.
- `-m sabi-code` alone still resolves through the default provider. The per-run
  opt-in must name both: `--provider custom:sabi -m sabi-code`.

The Nous inference catalog (`/v1/models`, read live 2026-09-21, 402 entries) carries
seven `:free` lanes: `inclusionai/ling-3.0-flash-fin:free`,
`inclusionai/ling-3.0-flash-sante:free`, `meituan/longcat-2.0:free` (1M context),
`poolside/laguna-s-2.1:free` and `poolside/laguna-xs-2.1:free` (262k, coding),
`stepfun/step-3.7-flash:free` (262k), `upstage/solar-pro4:free` (524k).
`laguna-s-2.1:free` is the verified coding default above; re-verify before
depending on the others. Tenant note: this host also holds a Copilot credential
pool (`hermes auth list`: nous OAuth + Copilot) — per-tenant fallbacks stay a
`hermes fallback` / `hermes model` terminal decision, not a committed config.

OpenCode Go and ChatGPT Plus remain native Hermes providers. Select them with Hermes' own
`hermes model` flow; their subscription entitlements are not silently transferred into Sabi.

## Maintainer note

The adapter must return the complete request and replace only Sabi attribution headers. Do not add
provider rebinding, tool execution, retry, or a second loop in middleware.
