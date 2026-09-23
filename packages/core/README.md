# @vizuh/sabi-router

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

## Around it

| Package | What it is |
|---|---|
| `@vizuh/sabi-controller` | The user-level product around this layer: `sabi setup`, `sabi serve`, `sabi doctor`, `sabi updates` |
| `@vizuh/sabi` | Sabi's Command Code mod (deprecated in favour of the layers above) |
| host adapters | Claude Code, Codex, OpenCode, Oh My Pi, Hermes, Kilo, Cline, Prime Agent, Orca, DeepSeek Harness |

## License

MIT
