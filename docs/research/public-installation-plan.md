# Public installation and host integration plan

Status: implementation plan, 2026-09-19. This replaces the development-only `npm link` assumption
for users who install Sabi on their own machines.

## Outcome

A new user should be able to install Sabi without cloning a repository or installing dependencies in
each worktree:

```bash
npm install --global @vizuh/sabi-controller
sabi setup
sabi doctor
```

`setup` detects the machine's host and harnesses, asks for consent before changing their user
configuration, installs the user-level daemon/service and reports exactly which integrations are
supported, partial or unavailable. Opening a new Orca worktree must not require another Sabi install.

The existing public `@vizuh/sabi` package remains the Command Code inference adapter. The controller
gets its own public package and release lane so the existing adapter contract is not silently changed.

## Current blockers

- The root controller package is private and its `bin` points at TypeScript workspace source.
- The controller imports private workspace packages such as `@sabi/core`; a temporary checkout with
  no `node_modules` cannot run it.
- The hook command defaults to bare `sabi`, but harness-launched processes cannot be assumed to inherit
  the user's interactive npm `PATH`.
- The daemon starts lazily from the CLI and has no user-login service installer.
- `packages/adapters/orca` is a source bridge, not an installed Orca integration. Orca plugin API v1
  exposes focused worktree/terminal calls and bounded status events, not a universal prompt hook.
- Inventory is currently scoped to the requested worktree. A global controller needs a registry of
  sessions across worktrees with stable identity and lifecycle state.
- Hooks exist for Claude, Codex and OpenCode. Other harnesses are spawn candidates or proxy clients,
  not controller integrations.

## Package and runtime boundary

### Public package

Publish the existing controller code as `@vizuh/sabi-controller` after bundling it and its private
workspace dependencies into a Node 22+ artifact. The package must contain:

- a compiled `sabi` CLI, never a runtime import of the checkout's `.ts` files;
- the daemon entrypoint and service templates;
- the Claude/Codex hook launcher;
- the OpenCode plugin resource;
- the Orca plugin manifest/worker resource, when the host install contract is verified;
- `sabi --version`, package provenance and an uninstall-safe upgrade path.

Keep the source workspace package private if needed; the public artifact is the bundle, not the
monorepo's `node_modules` graph. `npm pack` from a clean directory must be the first packaging gate.

### User-owned state

Keep code global and state user-scoped:

```text
config:  ~/.config/sabi/                    # preferences and integration consent
state:   ~/.local/state/sabi/               # daemon, registry, install metadata
data:    ~/.local/share/sabi/                # bounded traces and local evidence
runtime: ~/.local/state/sabi/sabi.sock       # Unix socket, mode 0600
```

Use the platform equivalents on macOS and Windows. Never put controller state, hooks or credentials
inside a worktree. Raw TokenScout reports and screenshots remain local under ignored runtime state;
they are not part of this public package or its telemetry.

## Runtime layers

### 1. User-level daemon

Add platform installers with idempotent status/repair/uninstall commands:

- Linux: systemd user unit, `enable --now`, no root requirement;
- macOS: per-user LaunchAgent;
- Windows: per-user startup/task mechanism;
- fallback: lazy start from a verified absolute launcher, with a clear degraded status.

Use a per-user Unix socket where available and an authenticated local transport on platforms without
one. Preserve the loopback-only boundary; do not expose a network daemon by default.

Required commands:

```text
sabi setup
sabi status
sabi doctor
sabi integrations list
sabi integrations repair
sabi upgrade
sabi uninstall
```

Setup must be safe to rerun, preserve one rollback copy per user config, and never print secrets.

### 2. Harness adapter contract

Do not promise “any harness” from the inventory list. Each adapter must prove these operations:

```text
detect → install/repair → identify session → receive prompt → dispatch → observe outcome → uninstall
```

Initial support matrix:

| Harness | First public target | Current status | Gate |
|---|---|---|---|
| Claude Code | user-level prompt hook | source hook exists | clean-machine install and live receipt |
| Codex | user-level session/prompt hooks | source hook exists | clean-machine install and live receipt |
| OpenCode | user plugin/config | source plugin exists | version-matched activation and live receipt |
| Orca | host plugin + inventory | source bridge only | consented install plus universal prompt/agent event, or explicit adapter fallback |
| Command Code | inference mod | separate adapter, not controller hook | controller event surface must be verified |
| Hermes / Prime / Pi / OMP / others | adapter-specific | not controller-supported | installed contract and end-to-end proof per harness |

An available executable is a spawn candidate, not evidence of integration. `sabi doctor` and `status`
must display that distinction.

### 3. Global session registry

The daemon should accept normalized registration/heartbeat/outcome events from adapters and Orca:

```text
machine → host → repo → worktree → harness → session → terminal
```

Store only bounded descriptors: stable session id, harness identity, worktree, branch, lifecycle,
capabilities, context availability, quota/rate-limit class and last observed status. Do not merge
sessions by shared path or prompt, and do not persist raw terminal transcripts by default.

The route request uses the current session as context but may choose eligible sessions in other
worktrees only when the adapter supplies an explicit handoff/dispatch contract.

### 4. Orca integration

Package the existing thin bridge, but do not claim that its current v1 API intercepts every harness.
The implementation has two acceptable paths:

1. Orca exposes a consented universal agent prompt/status surface; the plugin registers it and sends
   normalized events to the daemon.
2. Until then, the plugin provides inventory/dispatch only, while verified Claude/Codex/OpenCode
   user adapters handle prompts. Unsupported Orca terminals remain visibly unsupported.

The installer must use Orca's official plugin installation/consent surface. If the installed Orca
version has no such surface, `sabi setup` reports that fact and does not copy an unregistered plugin.

## Delivery sequence

### Phase A — publishable CLI

Bundle the controller and private workspace dependencies, add `--version`, package tests and a clean
`npm pack` smoke test. Prove the CLI from a temporary home and a directory with no repository or
`node_modules`.

### Phase B — daemon lifecycle and recovery

Add service installers, secure per-user IPC, `doctor`, repair, uninstall and upgrade. Prove restart,
stale daemon recovery, permissions, rollback and no-secret logging on Linux first; add macOS/Windows
templates only with platform checks.

### Phase C — user-level harness integrations

Move Claude, Codex and OpenCode installation behind the public package. Use absolute launchers,
version checks, consent, backups and idempotent repair. Test two unrelated worktrees from one daemon.

### Phase D — Orca host integration

Publish the plugin resource, verify the official install/consent path against the installed Orca
version, and add stable inventory/event registration. Do not broaden the claim beyond the events Orca
actually exposes.

### Phase E — global routing acceptance

Run live acceptance with two worktrees and at least two real harnesses:

```text
fresh install → setup → daemon healthy
→ 2 + 2 stays in current session
→ specialist task reaches a different eligible session
→ quota/dead target refreshes inventory and reroutes
→ structured handoff is preserved
→ unsupported harness is reported, never falsely selected
→ uninstall restores user configuration
```

Every result must record request, inventory, valid candidates, decision, concrete target, terminal
receipt and outcome. A JSON recommendation without terminal execution is not acceptance.

### Phase F — independent release lane

Create a controller-specific GitHub/npm workflow with provenance, clean-install tests and a release
note that states supported harness/version boundaries. Keep the existing `@vizuh/sabi` adapter release
workflow unchanged. Publish only after Phase E passes on a clean user environment.

## Non-goals for the first public installer

- no model marketplace or automatic subscription switching;
- no TokenScout dependency or remote design evidence in the public package;
- no automatic support claim for every executable found on `PATH`;
- no repository-local install or required `.sabi` project file;
- no raw prompt/transcript upload to a central service;
- no “global” label until cross-worktree identity and live execution are proven.
