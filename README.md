# Sabi

Adaptive routing for coding-agent trajectories.

Sabi sits between a coding harness and the models it can call. The harness keeps its own loop,
tools, permissions, history, and approvals. Sabi uses trajectory evidence such as tool calls,
results, failures, context pressure, capabilities, and provider state to choose what serves the
next inference or task transition.

Sabi is a routing layer with adapters, not another agent harness or editor.

**English** · [Português (BR)](README.pt-BR.md) · [中文](README.zh-CN.md)

![Sabi routing architecture](docs/images/sabi-routing.svg)

## Start here

Choose the surface that matches how you work:

| You use | Start with | What Sabi does | Current boundary |
| --- | --- | --- | --- |
| Command Code | [Command Code mod](docs/adapters/command-code.md) | Changes model and reasoning effort per continuing round inside the native loop | The published @vizuh/sabi npm artifact is this mod only |
| OpenCode | [OpenCode adapter](docs/adapters/opencode.md) | Routes requests through the local OpenAI-compatible proxy; optional controller hook | Native per-round model replacement is not claimed |
| Hermes | [Hermes adapter](docs/adapters/hermes.md) | Uses Hermes' llm_request seam to attribute requests to the Sabi proxy | Pinned/tested Hermes path; auxiliary and subagent paths have separate gates |
| Prime Agent | [Prime Agent adapter](docs/adapters/prime-agent.md) | Uses a custom OpenAI-compatible provider for proxy routing and probes | Native model/effort timing is experimental |
| Kilo CLI / VS Code | [Harness compatibility](docs/harnesses.md) | Uses the same local proxy recipe with client-specific metadata | CLI and extension are separate release gates |
| Claude Code | [Claude Code controller hook](docs/adapters/claude-code.md) | Lets the controller observe prompts and delegate/continue work across sessions | Does not switch the model inside an existing Claude session |
| Codex | [Codex controller hook](docs/adapters/codex.md) | Lets the controller observe lifecycle and prompt events | Does not switch the model inside an existing Codex session |
| Orca | [Orca adapter](docs/adapters/orca.md) | Supplies worktree/terminal inventory and capability-gated dispatch to the controller | Orca is the host/controller surface, not a model provider |

If you are unsure, read [Adapters](docs/adapters/README.md). It explains which path is inference
routing and which path is task/session coordination.

## The 60-second mental model

One task produces a trajectory, not one request:

~~~mermaid
flowchart LR
  H["Harness keeps its loop"] --> A["Adapter translates host events"]
  A --> S["Sabi core classifies the next round"]
  S --> M["Model/provider selected"]
  M --> H
  S --> E["Decision + evidence"]
~~~

A **Command Code** trajectory might look like:

| Round | Evidence | Decision |
| ---: | --- | --- |
| 1 | New instruction | Keep the session model |
| 2 | Repository search and reads | Cheap tier |
| 3 | Edit and implementation | Mid tier |
| 4 | Tests/build | Mid tier |
| 5 | Failing tool result | Strong tier |
| 6 | Recovery after the failure | Strong tier |
| 7 | Verification passes | Mid tier |

For proxy clients, the first request is classified as `first-turn` and routed to the configured tier (mid by default). Only the Command Code continuing-turn hook leaves round 1 on the session model.

Sabi makes a decision at the boundary the host exposes. It does not fork the host loop, replay
tools, or silently rewrite permissions.

## What is actually shipped?

Sabi currently has two product families:

1. **Inference adapters.** Command Code's in-process mod and the local OpenAI-compatible proxy
   route individual inference rounds.
2. **Controller adapters.** The controller observes supported host events and can continue,
   delegate, or spawn a bounded target when the host and execution receipts make that safe.

The families share routing concepts and core types, but they are not interchangeable. A Claude or
Codex hook does not prove native model switching. A model catalog entry does not prove plan
entitlement. A local mock test does not prove model quality or savings.

Support is reported in layers:

- Source and tests show that the adapter exists and its contracts are tested.
- A protocol test shows that a real client reached a local Sabi endpoint or host seam with a bounded fixture.
- A live smoke test shows that an approved authenticated upstream was exercised under a spend cap.
- A completed-task evaluation measures quality and cost against a fixed baseline.

Current evidence and limitations live in [Harness compatibility](docs/harnesses.md) and each adapter page.

## Install the right path

### Command Code

The published npm package is the native mod:

~~~bash
cmd mods add -g npm:@vizuh/sabi
cmd mods list
~~~

No Sabi provider key or local proxy is needed. The mod routes the Command Code subscription
already attached to the session. Round 1 stays on the session model by design; scheduling starts
with the next continuing round.

### Proxy clients

From a checkout:

~~~bash
git clone https://github.com/vizuh/sabi
cd sabi
npm install
npm start                 # loopback: http://127.0.0.1:8787/v1
~~~

Configure the adapter for OpenCode, Hermes, Prime Agent, Kilo, or another OpenAI-compatible
client. The client points at the base URL http://127.0.0.1:8787/v1 and requests the adaptive
alias sabi-code.

Sabi reads only credential names referenced by sabi.config.json. Existing environment variables
win, followed by SABI_SECRETS_FILE, a nearest workspace secrets/.env, and the per-user Sabi
secrets file. Sabi does not copy the loaded values into generated harness configuration or logs.
If you use a workspace secrets/.env, that source file is already inside the worktree: keep it
outside version control, add it to .gitignore, and protect its file permissions. See
[security and installation](docs/install.md).

### Controller surfaces

The controller is still checkout-based and experimental. Do not assume a public
@vizuh/sabi-controller registry release. From the checkout:

~~~bash
npm install
npm run controller -- setup
npm run controller -- doctor
npm run controller -- integrations list
~~~

Setup is explicit and idempotent. It can install user-scoped hooks for detected Claude Code,
Codex, and OpenCode installations, start a loopback daemon when the platform permits it, and
leave backups for rollback. Hooks fail open if Sabi is unavailable.

## Routing logic

The deterministic policy classifies the current state first, then applies hard constraints before
selecting a tier:

~~~mermaid
flowchart TD
  I["Round state: tools, results, failures, context, media"] --> C["Classify"]
  C --> P["Apply capability + transport gates"]
  P --> D["Choose cheap / mid / strong"]
  D --> J{"Ambiguous?"}
  J -- "no" --> U["Forward through host/proxy"]
  J -- "yes" --> V["Optional Jev judge over valid choices"]
  V --> U
  U --> R["Record allowlisted evidence"]
~~~

Default policy:

| Situation | Rule | Default target |
| --- | --- | --- |
| Read/search/bookkeeping | exploration | cheap |
| Edit/implementation | implementation | mid |
| Test/build/lint | verification | mid |
| Failing tool result | failure | strong |
| Stuck or context pressure | stuck / context-pressure | mid |
| Rate limit, quota, timeout | transport | transport tier; never escalate because it looks scary |
| Image/file input | capability | first configured tier that declares the modality |

Jev is optional semantic judgment for ambiguous proxy rounds. It is a judge, not a worker model.
Timeouts, invalid answers, and unavailable credentials fall back to deterministic policy.

## Estimates: what can improve?

Sabi is not shipping a universal savings claim yet. The following is a transparent example using
the rates in the checked-in configuration (USD per 1M tokens, verified 2026-09-18). It ignores
cache discounts, provider minimums, retries, and output generated by the optional judge. Recheck
rates before using it for a budget.

Assume an eight-round task:

| Tier | Rounds | Average input/output per round | Total tokens |
| --- | ---: | ---: | ---: |
| Cheap | 3 | 3k / 1k | 12k |
| Mid | 4 | 5k / 2k | 28k |
| Strong | 1 | 8k / 3k | 11k |
| **Total** | **8** | n/a | **51k** |

Using the example rates (cheap $0.06/$0.12, mid $0.20/$1.20, strong $2/$10):

- Adaptive mix: about **$0.0605**.
- All-strong at the same 37k input + 14k output: about **$0.2140**.
- Illustrative reduction against all-strong: **$0.1535 / 71.7%**.
- All-mid would be about **$0.0242**, so Sabi is not claiming it beats a fixed mid model on every
  task. The point is to reserve strong capacity for evidence that justifies it.
- Token count in this simple example is still **51k**. Sabi changes the price and capability
  assigned to those tokens; it does not magically remove context or tool output.
- Strong-tier share falls from 100% to **21.6% of tokens**. That is a routing allocation estimate,
  not a quality result.
- One 6k-token Jev input at the configured $0.042/M judge rate adds roughly **$0.00025** before
  judge output/network costs. The report counts routing overhead separately.

The exact formulas and a worked spreadsheet-style example are in
[Estimates and accounting](docs/estimates.md). The production claim to earn is measured on a
fixed completed-task set: cost per completed task, success, escalation precision, latency, and
router/judge overhead.

## For maintainers

Sabi is designed to be a thin adapter around a host's supported extension point:

- The host owns the agent loop, tools, approvals, compaction, retry policy, and user-visible model pin.
- An adapter detects, identifies a session, receives an event/request, dispatches through a supported
  seam, observes an outcome, and uninstalls cleanly.
- Unknown capabilities remain unknown. Sabi refuses unsafe routes instead of dropping tools, files,
  images, reasoning fields, or structured output.
- Routing metadata is local attribution, not a permission mechanism. Loopback is the default.
- A catalog listing is not entitlement; a hook installation is not live routing; a mock pass is not
  a customer benchmark.

See [Maintainer guide](docs/maintainers.md) for the contract, evidence ladder, fixtures, rollback
expectations, and how to propose an adapter without creating a second policy implementation.

## Repository map

~~~text
packages/core/                 shared state, policy, routing, telemetry
packages/server/               local OpenAI-compatible proxy
packages/adapters/             Command Code, Hermes, OpenCode, Orca, Prime Agent
packages/controller/           task/session controller and host hooks
packages/evals/                frozen evals, client smoke checks, accounting
docs/adapters/                 user-facing adapter guides
docs/research/                 verified upstream evidence and release gates
~~~

Useful references:

- [Adapter directory](docs/adapters/README.md)
- [Harness evidence](docs/harnesses.md)
- [Install and security](docs/install.md)
- [Maintainer guide](docs/maintainers.md)
- [Estimates](docs/estimates.md)
- [Decisions and boundaries](docs/decisions.md)

Sabi is MIT licensed. The repository is public at https://github.com/vizuh/sabi.
