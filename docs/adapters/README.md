# Sabi adapters

Adapters are optional bridges, not installation prerequisites. Install Sabi once at user scope, then use this page to choose a host-specific capability. The core/controller remains independent of Command Code, OpenCode, Claude Code, Codex, Hermes, Orca, and any other harness.

~~~bash
npm install --global @vizuh/sabi-controller
sabi setup
~~~

If a host has no verified execution seam, Sabi can still document or observe the boundary, but the adapter must not claim native model switching that the host cannot expose.

## Choose by goal

| Goal | Adapter(s) | Boundary |
| --- | --- | --- |
| Change model + reasoning effort inside Command Code | Command Code mod | Per-round model + effort |
| Route model/provider requests using your own credentials | OpenCode, Hermes, Prime Agent, Kilo, any OpenAI-compatible client | Local proxy; model/provider only |
| Move work between existing sessions/worktrees | Claude Code, Codex, OpenCode controller hooks + Orca | Task/session controller |
| Add a new host | Follow [the maintainer contract](../maintainers.md) | Adapter proposal |

## Capability map

| Adapter | Form | Current status | Optional entry point |
| --- | --- | --- | --- |
| [Command Code](command-code.md) | In-process mod | Shipped per-round model + effort routing | cmd mods add -g npm:@vizuh/sabi |
| [OpenCode](opencode.md) | Local proxy + optional controller hook | Protocol-tested proxy; controller partial | npm start + npm run connect:opencode |
| [Hermes](hermes.md) | Native llm_request middleware + proxy | Pinned Hermes 0.21.3 path tested; auxiliary paths separate | Isolated profile |
| [Prime Agent](prime-agent.md) | Custom OpenAI-compatible provider + probes | Proxy compatibility tested with mock; native timing experimental | Manual profile |
| [Kilo](kilo.md) | OpenAI-compatible provider | CLI recipe tested; VS Code is a separate gate | Manual profile |
| [Claude Code](claude-code.md) | User-prompt controller hook | Partial controller integration | sabi setup |
| [Codex](codex.md) | Lifecycle/prompt controller hooks | Partial controller integration | sabi setup |
| [Orca](orca.md) | Plugin + inventory/dispatch bridge | Inventory and bounded dispatch surface | sabi setup + Orca |

## Read support correctly

A row marked tested means that the evidence described on its page exists. It does not mean that all
model families, subscriptions, child agents, extensions, or future releases are supported.

- **Inference routing** changes the next model/provider request.
- **Controller routing** chooses a session or worktree action.
- **Detection** only means a command exists on PATH.
- **Catalog** only means a model name was observed; entitlement and quota remain unknown.
- **Mock compatibility** proves protocol preservation, not quality or savings.

The package-level README is the implementation reference where one exists:
[Command Code](../../packages/adapters/command-code/README.md),
[Hermes](../../packages/adapters/hermes/README.md), and
[Orca](../../packages/adapters/orca/README.md).
