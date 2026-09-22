# Oh My Pi adapter proposal

## Host and observed seam

- Host: Oh My Pi (`omp`) 18.2.8, installed on 2026-09-22.
- Upstream repository: `https://github.com/can1357/oh-my-pi`, package directory
  `packages/coding-agent`.
- Upstream commit: not exposed by the installed npm package; this proposal is pinned to the
  installed version and the inspected `registerProvider()` contract, not to an unverified commit.
- Seam: extension factory loaded with `omp --extension <file>` or from
  `~/.omp/agent/extensions/`; the factory calls `pi.registerProvider()`.

The adapter does not patch OMP internals or create a second agent loop. OMP remains responsible for
session history, tools, approvals, compaction, retries, cancellation and user-visible state. Sabi
receives the OpenAI-compatible request at its local proxy and chooses the upstream model for that
request.

## Lifecycle and request preservation

`packages/adapters/oh-my-pi/src/sabi-extension.mjs` registers provider `sabi` with model `sabi-code`
and base URL `http://127.0.0.1:8787/v1` by default. OMP's native OpenAI-completions client sends
messages, tools, images, streaming, reasoning effort and cancellation through that provider. Sabi's
proxy remains responsible for adaptive routing and response normalization.

The adapter does not claim native OMP model mutation between turns. Its routing boundary is the
provider request: OMP selects the stable synthetic model `sabi/sabi-code`, and Sabi selects the
upstream model behind that alias.

## Identity, cancellation, timeout and retry ownership

The extension adds no opaque session identity and no controller hook. OMP owns cancellation,
timeouts, retries and session lifecycle. Sabi receives the normal proxy request and records only its
existing bounded metadata; no prompt, tool output or credential is copied into the adapter.

## Capabilities

- Text and image input are advertised because the Sabi proxy has those reachable-tier capabilities.
- Tools and streaming use OMP's built-in OpenAI-compatible transport; the adapter does not execute or
  transform tools.
- Reasoning effort is exposed through OMP's generic effort ladder and is passed as provider payload
  metadata for Sabi/upstream compatibility.
- Audio, provider-specific structured output and host-native child-agent routing are not added by
  this adapter.

## Configuration and rollback

The adapter is side-effect-free. Load it explicitly with `--extension`, or copy the extension file to
OMP's user extension directory. It does not overwrite OMP settings, credentials or profiles. Rollback
is removing the copied extension or omitting the `--extension` argument.

Environment overrides:

- `SABI_OMP_BASE_URL` — loopback `http://.../v1` endpoint.
- `SABI_BASE_URL` — shared Sabi fallback used when the OMP-specific variable is absent.
- `SABI_OMP_CONTEXT_WINDOW` and `SABI_OMP_MAX_TOKENS` — positive metadata values for OMP compaction
  and output controls.

The adapter rejects non-loopback URLs, credentials, query strings, fragments and paths other than
`/v1`. The API key is an explicit local placeholder; Sabi's loopback proxy does not use it as a
provider credential.

## Evidence boundary and smoke result

Source review and fixture contract tests cover the provider registration shape, URL safety and
metadata overrides. On 2026-09-22, the installed Oh My Pi 18.2.8 CLI loaded the extension from the
checkout and completed one non-interactive streaming text turn against a loopback mock at
`127.0.0.1:18787/v1`; the observed output marker was `OMP_SABI_SMOKE_OK`, and no real upstream
provider or credential was used.

This proves extension loading, provider registration and OpenAI-compatible streaming transport. It
does not prove paid provider access, model entitlement, tool-call streaming, quality, savings or
native per-turn model mutation inside OMP. A future bounded smoke may add a tool-call response
fixture, but the current adapter deliberately leaves tool execution to OMP.
