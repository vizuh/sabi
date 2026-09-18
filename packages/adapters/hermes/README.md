# Hermes metadata bridge

Opt-in, zero-dependency `llm_request` plugin for Hermes **0.21.3** at
[`01382698fc32ec7740b6a204d9b7a6abeac74d33`](https://github.com/NousResearch/hermes-agent/tree/01382698fc32ec7740b6a204d9b7a6abeac74d33).
This is attribution, not native model/effort routing or full Hermes certification.
See [compatibility evidence](../../../docs/research/hermes-compatibility.md).

## Contract

- Only `sabi-code`, `chat_completions`, `hermes.middleware.v1`, and the exact
  configured loopback `/v1` endpoint qualify.
- Return the complete request. Copy only its top-level map and `extra_headers`;
  preserve all other kwargs, tools, argument strings, IDs, order and SDK objects.
- Replace case variants of `X-Sabi-Client`, `X-Sabi-Session`, and `X-Sabi-Turn`.
  Use `hermes` plus the event's opaque `session_id` and `turn_id`.
- IDs must be 1–128 ASCII characters from `[A-Za-z0-9._:-]`. Omit unsafe/missing
  IDs and stale Sabi headers. Never derive identity from prompt text.
- Hermes `turn_id` identifies a user turn, including its tool-loop requests.
  It is **not** a unique inference-request ID. Sabi assigns request IDs.
- No provider rebinding, policy copy, execution wrapper, tool hook, HTTP client,
  retry, or second agent loop. Hermes middleware is fail-open, so it cannot be
  a permission or budget enforcement gate.

## Isolated opt-in recipe

[config.yaml.example](config.yaml.example) is a **template**, not ready to run.
Use a new `HERMES_HOME` within the project runtime directory. Replace its context
placeholder with an operator-verified limit. Keep capabilities false unless all
eligible Sabi targets support them. No production model facts or prices are supplied.
Keep the real upstream key in Sabi's environment only. In this Hermes build,
`discover_models: false` does not suppress automatic local-server metadata GETs;
the native mock probe records them and verifies that 404s do not break the task.

Copy `plugin/` to `$HERMES_HOME/plugins/sabi-metadata/`. The template enables that
plugin by name. Do not install into a user's existing `.hermes` directory. Start
Hermes with that same `HERMES_HOME`, using its normal `hermes chat` command.

The default Sabi base is `http://127.0.0.1:8787/v1`. For a different loopback port,
set `SABI_HERMES_BASE_URL` to the exact configured base. The plugin rejects remote
hosts, URL credentials, query strings and fragments. Changing the model away from
`sabi-code` leaves that request untouched. Do not configure a second router.

Rollback: stop selecting this isolated profile, or remove `sabi-metadata` from
its `plugins.enabled`. Preserve the profile; do not delete user state or change
other providers. Without the plugin, custom-provider transport can still work but
stable session attribution is unknown.

## Focused tests

From the Sabi root, using this adapter's project environment:

```sh
UV_PROJECT_ENVIRONMENT="$PWD/.sabi/compat/hermes/unit-env" \
  uv run --project packages/adapters/hermes --python 3.13 \
  python -B -m unittest discover -s packages/adapters/hermes/tests -v
```

The native probe additionally requires the pinned source checkout at
`.sabi/compat/hermes/upstream` and its editable base-dependency environment at
`.sabi/compat/hermes/env`. Upstream's documented development install is `uv sync`;
use `--frozen --no-dev --python 3.13` and set `UV_PROJECT_ENVIRONMENT` to that `env`
path. Set `HOME`, `HERMES_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `UV_CACHE_DIR`,
and `UV_PYTHON_INSTALL_DIR` to separate paths below `.sabi/compat/hermes` **before**
installing. Do not run the shell installer, login, extras, or the upstream suite.

`probe_client.py` runs the real `hermes` CLI with a bounded native file-tool round
and resume. The default mode targets the mock directly. `--via-sabi` starts the
real local Sabi server through `probe_sabi.mjs`, in strict compatibility mode with
Jev off, and places it before the mock. It also checks hashed attribution and
stripped upstream headers. All model limits in that helper are synthetic fixtures.
It uses fragmented Chat Completions SSE and no provider credentials.

Run it inside a Linux network namespace with only the runtime, project packages
and workspace dependencies visible under `/home` (the recorded runs used
`bwrap --unshare-net --unshare-pid --die-with-parent`). Pass the outside namespace
ID as `--host-netns "$(readlink /proc/self/ns/net)"`. It refuses the same namespace.
The mock server and Hermes must share that isolated namespace; keep `/proc`
mounted for the check. Only the runtime directory needs writable access. From
the Sabi root after the isolated install:

```sh
runtime="$PWD/.sabi/compat/hermes"
adapter="$PWD/packages/adapters/hermes"
host_netns="$(readlink /proc/self/ns/net)"
env -i HOME="$runtime/home" PATH=/usr/bin:/bin \
  bwrap --unshare-net --unshare-pid --die-with-parent --ro-bind / / \
  --tmpfs /home --ro-bind "$PWD/packages" "$PWD/packages" \
  --ro-bind "$PWD/node_modules" "$PWD/node_modules" --bind "$runtime" "$runtime" \
  --dev /dev --proc /proc --chdir "$runtime" \
  "$runtime/env/bin/python" -B "$adapter/probe_client.py" --host-netns "$host_netns" --via-sabi
```

Results are selected fields in `.sabi/compat/hermes/runs/<timestamp>/summary.json`.
The proxy variant requires the repository's existing workspace dependencies and
`/usr/bin/node` with TypeScript stripping support. Neither variant contacts a paid
upstream model. Remove `--via-sabi` to rerun the direct-client baseline.
