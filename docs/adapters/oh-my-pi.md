# Oh My Pi adapter

The Oh My Pi adapter keeps OMP's native agent loop and registers Sabi as a local OpenAI-compatible
provider. OMP still owns history, tools, approvals, compaction, cancellation and retries. Sabi
selects the upstream model for each proxy request behind the stable `sabi/sabi-code` alias.

## Requirements

- Oh My Pi 18.2.8 or a later release with `pi.registerProvider()` support.
- A running Sabi server on `http://127.0.0.1:8787`.
- This checkout, or the adapter extension copied to an OMP extension directory.

Start Sabi from this checkout with:

~~~bash
npm start
~~~

## Explicit load

Run OMP with the extension and the synthetic Sabi model:

~~~bash
omp \
  --extension packages/adapters/oh-my-pi/src/sabi-extension.mjs \
  --model sabi/sabi-code
~~~

To make the extension available to all OMP sessions, copy it into the user extension directory:

~~~bash
install -Dm0644 \
  packages/adapters/oh-my-pi/src/sabi-extension.mjs \
  ~/.omp/agent/extensions/sabi.mjs
omp --model sabi/sabi-code
~~~

The copy is the only user configuration mutation. Remove `~/.omp/agent/extensions/sabi.mjs` to
roll back the integration; the adapter never edits OMP settings or credentials.

## Endpoint overrides

The adapter defaults to `http://127.0.0.1:8787/v1`. Set `SABI_OMP_BASE_URL` for another loopback
port, or use the shared `SABI_BASE_URL` fallback:

~~~bash
SABI_OMP_BASE_URL=http://127.0.0.1:9887/v1 \
omp --extension packages/adapters/oh-my-pi/src/sabi-extension.mjs \
  --model sabi/sabi-code
~~~

`SABI_OMP_BASE_URL` must be an HTTP loopback URL ending in `/v1`; credentials, query strings,
fragments, remote hosts and other paths are rejected. `SABI_OMP_CONTEXT_WINDOW` and
`SABI_OMP_MAX_TOKENS` override the model metadata OMP uses for compaction and output limits.

`SABI_OMP_MAX_TOKENS` is the output ceiling OMP asks Sabi for on every round. Sabi routes on that
number: a tier whose declared `maxOutputTokens` is smaller is skipped for the cheapest tier that
declares enough (rule `output-capacity`), and a round whose requested output no configured tier can
serve fails as an explicit incompatibility instead of silently running on an unknown-capacity
backend. Keep the ceiling inside what at least one configured tier declares.

## Borrowed authentication

OMP can route a built-in provider through Sabi while keeping its own credential. OMP documents
`pi.registerProvider(name, { baseUrl })` as an override for an existing provider, and it resolves the
credential through its own auth storage independently of the base URL — which is what makes the
borrow work. The extension reads the provider names from the environment:

~~~bash
SABI_OMP_BORROW_PROVIDERS=anthropic,opencode-go \
omp --extension packages/adapters/oh-my-pi/src/sabi-extension.mjs
~~~

Each named provider is repointed at Sabi's base URL with `{ baseUrl }` and nothing else: no key is
copied into the extension, and OMP keeps sending its own credential. Sabi decides the model per
round and forwards the request to the provider that credential belongs to.

## Support boundary

This is inference-only provider routing. It does not change OMP's selected upstream model natively;
OMP sends `sabi-code`, and Sabi routes behind that alias. The adapter advertises text, image, tools,
streaming and generic reasoning effort through OMP's OpenAI-compatible transport. It does not add
host-native child-agent routing, audio, or provider-specific structured-output behavior.

See the [compatibility proposal](../research/oh-my-pi-adapter.md) for the evidence boundary and
bounded smoke plan. A successful adapter load proves registration only; it does not prove paid
provider access, model entitlement, quality or savings.
