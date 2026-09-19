# Harness adapter contract v1

Sabi does not treat an executable on `PATH` as an installed integration. A controller adapter is
ready only after it can account for every operation below:

```text
detect → install/repair → identify-session → receive-prompt → dispatch
       → observe-outcome → uninstall
```

Each adapter reports a manifest with:

- `contractVersion: 1`;
- a stable `id` and display name;
- `status`: `integrated`, `partial`, `inventory-only`, `inference-only` or `unsupported`;
- `consent`: whether user configuration or host permissions are required;
- an operation mode for every contract operation: `native`, `hook`, `cli` or `missing`.

`sabi integrations list --json` emits these manifests, including whether the executable is detected
and whether all operations are present. `ready: false` is expected until the adapter has an explicit
session identity and a real prompt/outcome receipt.

Adapters may register bounded session state through the authenticated daemon endpoints
`/v1/sessions/register`, `/v1/sessions/heartbeat` and `/v1/sessions/outcome`. Sabi stores a hashed
session identity, not the provider's raw id, and expires entries after ten minutes without a
heartbeat. Registered sessions are observable with `sabi sessions`; they are not dispatch targets
until the adapter supplies and proves a dispatch transport.

Current boundary:

| Adapter | Status | Missing proof |
|---|---|---|
| Claude Code | partial | clean-machine consent and live prompt/outcome receipt |
| Codex | partial | clean-machine consent and live prompt/outcome receipt |
| OpenCode | partial | clean-machine consent and live prompt/outcome receipt |
| Orca | inventory-only | official consented plugin install and universal prompt event |
| Command Code | inference-only | controller prompt/dispatch contract |
| Hermes, Prime Agent, Pi, OMP | unsupported | installed runtime contract and end-to-end adapter |

An adapter must fail closed at the controller boundary when it cannot prove the target operation.
The controller may still display an executable as a spawn candidate, but it must not report that
candidate as an installed controller integration.
