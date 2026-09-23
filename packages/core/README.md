# @vizuh/sabi

**Sabi is the thin routing layer for coding agents.** It decides *which model, reasoning effort and
provider* should serve the next round of a task, from the evidence that round actually produced —
tool results, failures, context pressure, verification — rather than pinning one model to a whole
task or classifying the first prompt and hoping.

This package is that layer and nothing else: a library, no harness, no loop, no daemon.

```bash
npm install @vizuh/sabi-router
```

```ts
import { loadConfig, route } from '@vizuh/sabi-router'

const config = loadConfig('./sabi.config.json')
const decision = route(request, config)
// -> { tier, rule, reason, upstream, upstreamModel, state, recovery }
```

## What you get

- **A deterministic policy** over trajectory state — exploration, implementation, verification,
  failure, stuck, context pressure — so a round's cost tracks what the round is doing.
- **Capability as a hard constraint**, not a preference: image modalities, declared tools, the output
  ceiling, and free-only billing rules can disqualify a tier before it is chosen.
- **Escalation without thrash**: a failing round moves up the ladder; a recovering one moves back down.
- **Per-tier hard gates**: the requested output must fit a tier that declares it, and a substitute
  must declare the capacity it is chosen for.
- **Typed decisions** with bounded evidence, safe to log: no prompts, no credentials, no raw secrets.

## What it is not

Sabi does not own the agent loop. The harness keeps its own loop, tools, permissions, history and
approvals. It routes the next inference, and — through a host that exposes a decision boundary — it
can hand a task to another session. It is not a harness, not an IDE, and not an orchestrator.

Support is reported in layers. Source and tests show a contract exists; a protocol test shows a real
client reached a Sabi endpoint; a live smoke shows an authenticated upstream was exercised; an
evaluation measures quality and cost against a baseline. A catalog entry, a mock pass, or a hook
install proves none of those.

## Surfaces it carries

The layer is the product; the host integrations are files in this package, one per host, so installing
Sabi is installing all of it:

| Host | Entry point in this package | How the host loads it |
| --- | --- | --- |
| Command Code | `mods/command-code/sabi.mjs` | `commandcode.mods`; `cmd mods add -g npm:@vizuh/sabi` |
| Oh My Pi | `mods/oh-my-pi/sabi-extension.mjs` | `omi.extension`; `omp --extension …` or a user extension directory |
| OpenCode | `plugins/opencode/sabi-hook.mjs` | `opencode.plugin`; the controller hook Sabi installs |
| Orca | `plugins/orca/{orca-plugin.json,main.mjs}` | `orca.plugin`; the Orca plugin bridge |

Claude Code and Codex have no file to carry: their integration is the `sabi` CLI, which installs and
repairs their hooks (`sabi setup`, `sabi hooks install`).

The per-host packages remain as optional slices for someone who wants one integration and nothing
else — `@vizuh/sabi-commandcode` for the mod on its own. The routing layer is never split out of
this name: `@vizuh/sabi` is Sabi.

## License

MIT
