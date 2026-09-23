# Sabi adapters

**English** · [Português (BR)](README.pt-BR.md)

Adapters are optional bridges, not installation prerequisites. Install Sabi once at user scope, then use this page to choose a host-specific capability. The core/controller remains independent of Command Code, OpenCode, Claude Code, Codex, Hermes, Orca, and any other harness. The published controller covers the user-level daemon and hooks; Hermes and OpenCode inference through the local proxy still use the checkout-based setup in [the install guide](../install.md).

~~~bash
npm install --global @vizuh/sabi-controller@0.1.0
sabi setup
sabi doctor
~~~

If a host has no verified execution seam, Sabi can still document or observe the boundary, but the adapter must not claim native model switching that the host cannot expose.

## Choose by goal

| Goal | Adapter(s) | Boundary |
| --- | --- | --- |
| Change model + reasoning effort inside Command Code | Command Code mod | Per-round model + effort |
| Route model/provider requests using your own credentials | OpenCode, Hermes, Prime Agent, Kilo, any OpenAI-compatible client | Local proxy; model/provider only |
| Move work between existing sessions/worktrees | Claude Code, Codex, OpenCode controller hooks + Orca | Task/session controller |
| Add a new host | Follow [the maintainer contract](../maintainers.md) | Adapter proposal |

## Borrowed authentication

Sabi can sit between a harness and the model it already talks to. The harness keeps its own
credential and keeps sending it; Sabi decides which model serves each round and forwards the
request with the credential it received, to the provider that credential belongs to. **Sabi holds
no credential of its own on this path** — no file is opened, nothing is written to disk, and the
only outbound destination is the provider the harness would have called itself. The upstream is
declared `auth: passthrough`, which forbids an `apiKey` on it.

The harness sends its own wire format, so Sabi accepts the harness's protocol directly:
`POST /v1/messages` (Anthropic Messages) and `POST /v1/responses` (OpenAI Responses), alongside the
existing `POST /v1/chat/completions`. Only the `model` field is rewritten.

| Adapter | Borrowed rounds | How the harness is repointed |
| --- | --- | --- |
| [Claude Code](claude-code.md) | Yes — Anthropic Messages | `ANTHROPIC_BASE_URL` points at Sabi; Claude Code keeps its own subscription credential |
| [Codex](codex.md) | Yes — OpenAI Responses | A `model_providers.<id>` entry with `base_url` and `wire_api` |
| [Oh My Pi](oh-my-pi.md) | Yes — either format | `pi.registerProvider("<provider>", { baseUrl })` overrides a built-in provider; OMP keeps its own credential |
| [OpenCode](opencode.md) | Yes — either format | A provider entry with a custom `baseURL` |
| [Hermes](hermes.md) | Yes — either format | Hermes' own provider base URL points at Sabi |
| [Cline](cline.md) / [Kilo](kilo.md) | Partly | Their custom OpenAI-compatible provider accepts a base URL; the key configured there is the one Sabi forwards, so this is a key you supplied, not a subscription borrow |
| [DeepSeek Harness](deepseek-harness.md) | No — uses the OpenAI route | It is an OpenAI-compatible client, so it uses `sabi/sabi-code`, not a borrowed native format |
| [Command Code](command-code.md) | No | The mod runs in-process inside the harness; there is no base URL to repoint |
| [Orca](orca.md) | No | Orca is the editor/coordinator, not a model client |
| [Prime Agent](prime-agent.md) | Unverified | A custom provider entry may accept a base URL; not verified here |

Rows marked *yes* state what the harness documents, not a live run against a paid subscription. The
borrowed route refuses rather than guessing: a round with no credential on the request, or a tier
whose upstream holds its own key, is refused with a typed error instead of falling back to a
different provider.

## Capability map

| Adapter | Form | Current status | Optional entry point |
| --- | --- | --- | --- |
| [Command Code](command-code.md) | In-process mod | Shipped per-round model + effort routing | cmd mods add -g npm:@vizuh/sabi-commandcode |
| [OpenCode](opencode.md) | Local proxy + optional controller hook | Protocol-tested proxy; controller partial | sabi serve (or npm start from a checkout) + npm run connect:opencode |
| [Oh My Pi](oh-my-pi.md) | OpenAI-compatible extension provider | Source + fixture contract + installed OMP 18.2.8 loopback smoke tested | `omp --extension ... --model sabi/sabi-code` |
| [Hermes](hermes.md) | Native llm_request middleware + proxy | Pinned Hermes 0.21.3 path tested; auxiliary paths separate | Isolated profile |
| [Prime Agent](prime-agent.md) | Custom OpenAI-compatible provider + probes | Proxy compatibility tested with mock; native timing experimental | Manual profile |
| [Kilo](kilo.md) | OpenAI-compatible provider | CLI recipe tested; VS Code is a separate gate | Manual profile |
| [Cline](cline.md) | OpenAI-compatible provider | Protocol fixture tested; live extension run pending | Manual profile |
| [Claude Code](claude-code.md) | User-prompt controller hook | Partial controller integration | sabi setup |
| [Codex](codex.md) | Lifecycle/prompt controller hooks | Partial controller integration | sabi setup |
| [Orca](orca.md) | Plugin + inventory/dispatch bridge | Inventory and bounded dispatch surface | sabi setup + Orca |
| DeepSeek Harness | DSH bundle + Sabi proxy | Inference-only; developer-preview runtime, live DSH receipt pending | `dsh plugin --profile <name> add @vizuh/sabi-deepseek-harness` |

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
[Hermes](../../packages/adapters/hermes/README.md),
[DeepSeek Harness](../../packages/adapters/deepseek-harness/README.md), and
[Orca](../../packages/adapters/orca/README.md).
