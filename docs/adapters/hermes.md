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

The wizard creates an isolated `HERMES_HOME`, copies the plugin, and writes a
Nous-backed or OpenRouter-backed Sabi config according to `--upstream`. Read the detailed [Hermes adapter README](../../packages/adapters/hermes/README.md)
before changing the profile. The target directory must be new or empty; keep an existing
personal `.hermes`/Hermes profile untouched.

The exact loopback base must be present in `SABI_HERMES_BASE_URL`; the plugin fails open for
another host or an unrecognised endpoint. On this host, `qwen2.5-coder:7b` has a 32768-token
context and Hermes 0.21.3 requires at least 64000 for a custom model. Use Nous or a local model
with a verified context of at least 64000 for the Hermes path; Qwen remains available through a
direct Sabi/Ollama path.

OpenCode Go and ChatGPT Plus remain native Hermes providers. Select them with Hermes' own
`hermes model` flow; their subscription entitlements are not silently transferred into Sabi.

## Maintainer note

The adapter must return the complete request and replace only Sabi attribution headers. Do not add
provider rebinding, tool execution, retry, or a second loop in middleware.
