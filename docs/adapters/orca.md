# Orca adapter

Orca is Sabi's host/controller surface. It exposes worktrees, terminal handles, and bounded status
events that the controller can use to select or dispatch an agent.

The small Orca plugin exports `sabi.dispatch`. The controller owns orchestration logic, so the
plugin does not duplicate routing policy, usage detection, spawning, or orchestration.

## What is covered

- Worktree and terminal inventory.
- Matching the current worktree and optional explicit terminal.
- Capability-gated terminal.sendText dispatch.
- Typed execution receipts and idempotency keys at the controller boundary.
- OpenCode as a controller spawn candidate when the installed Orca inventory proves it.

## What is not claimed

Orca does not make Sabi a universal model router. An executable on PATH is not an integrated
adapter, and an Orca terminal handle does not prove provider identity. Native model switching
remains the responsibility of the target harness/provider seam.

See the package [README](../../packages/adapters/orca/README.md) and
[controller contract](../maintainers.md).
