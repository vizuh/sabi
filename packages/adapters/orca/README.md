# Sabi Orca bridge

This is the deliberately small Orca plugin surface for Sabi. It contributes one command,
`sabi.dispatch`, and observes Orca worktree/agent events. The command reads the focused worktree,
validates an explicit terminal when supplied, and sends the request through Orca's
capability-gated `terminal.sendText` call.

The plugin does not duplicate Sabi routing, usage detection, spawning, or orchestration. Those
remain in `@sabi/controller` and its `orca-ide` adapter because Orca plugin API v1 exposes only
focused-worktree labels/terminal IDs and bounded status events. The CLI remains the richer V1
fallback until Orca adds those host methods.

OpenCode is already a controller harness: when `opencode` is on `PATH`, inventory includes it as a
spawn candidate, and the orchestration selector accepts `opencode`. The installed runtime checked
for this change is OpenCode `1.18.30`. The plugin intentionally does not infer provider identity
from a terminal ID because the official plugin projection does not expose it.
