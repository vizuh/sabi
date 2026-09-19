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

Current boundary:

| Adapter | Status | Missing proof |
|---|---|---|
| Claude Code | partial | stable session identity and clean-machine live receipt |
| Codex | partial | stable session identity and clean-machine live receipt |
| OpenCode | partial | stable session identity and clean-machine live receipt |
| Orca | inventory-only | official consented plugin install and universal prompt event |
| Command Code | inference-only | controller prompt/dispatch contract |
| Hermes, Prime Agent, Pi, OMP | unsupported | installed runtime contract and end-to-end adapter |

An adapter must fail closed at the controller boundary when it cannot prove the target operation.
The controller may still display an executable as a spawn candidate, but it must not report that
candidate as an installed controller integration.
