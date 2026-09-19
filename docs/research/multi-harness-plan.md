# Multi-harness support plan

> Scope note (2026-09-19): PR #22 adds an experimental controller host-hook surface for Claude,
> Codex and OpenCode. That bridge routes controller actions and does not change the inference-routing
> status below; native per-round model/effort routing still requires the separate evidence gates in
> this document.

Proposal for approval, 2026-09-18. All four have a documented custom-provider path;
none has passed a Sabi integration test in this review. [Pinned evidence and limits](harness-support-evidence.md).

## Goal and scope

- **Goal:** each named harness completes a bounded, multi-round tool task through Sabi,
  with correct streaming, tools, cancellation, attribution and unchanged permissions.
- **Scope:** Nous Research Hermes Agent, OpenCode, Kilo CLI and VS Code extension,
  and Prime Agent. Retain the existing Command Code adapter as a regression baseline.
- **Constraints:** one core policy, native host loops, local-first, no fork, new database,
  orchestration framework or copied policy in another language. Plan only for now.
- **Verification:** source/version checks for this plan; offline contracts, real-client
  mock tests and separately approved live smoke tests before claiming support.
- **Pointers:** [existing proxy plan](opencode-terminal-plan.md), [Prime evidence](prime-agent-reuse.md),
  [current implementation](backlog-implemented.md), [router lessons](router-learnings.md).

## One core, two integration paths

**First: class B, custom provider → existing Sabi proxy → OpenRouter.** Each inference
request can be routed while the client retains tools, approvals, history and compaction.
This uses a separately authorized upstream API key; it does not transfer a host's login,
subscription credits or model entitlements into Sabi. Keep the real key in Sabi only.

**Later: class A, supported native hook → shared planner → host provider.** Use this
only after proving model/effort changes affect the next inference in the same trajectory.
Child-model selection, prompt instructions and internal functions are not that proof.
Never activate two routing authorities for the same request. Keep policy in existing
`packages/core`; thin adapters translate observations and apply decisions.

## Host-specific paths

All proxy recipes target `http://127.0.0.1:8787/v1` and the `sabi-code` alias.

| Surface | First integration | Native follow-up / gate |
|---|---|---|
| Hermes Agent | Custom provider; explicitly select `chat_completions` | Per-request middleware exists upstream; test compatible model/effort rewrites, fail-open behavior and attribution |
| OpenCode 1.18.30 | Custom `@ai-sdk/openai-compatible` provider | Local plugin 1.18.4 differs from CLI; defer native routing until matched hooks prove it |
| Kilo CLI | Documented `openai-compatible` provider, explicit model and limits | Test actual installed build; do not assume OpenCode parity |
| Kilo VS Code | Custom provider → **OpenAI Compatible**, manual alias and limits | Test extension separately; UI setup is not protocol certification |
| Prime Agent 0.9.5 | Custom model/provider with `api: "openai-completions"` | Documented model/effort setters need same-parent-round timing tests; `spawn` is not a substitute |

Existing core/server/evals are the base, not new packages to create. Current gaps include
parameter compatibility and prompt-prefix session attribution; see the evidence note.
`route` and `planRound` share `decideTier`; preserve one policy while improving inputs.

## Delivery sequence

1. **Shared contract first.** Extend existing proxy/core fixtures. Preserve original tool
   names, arguments, IDs and result order on the wire; use host-specific semantic maps only
   for classification. Unknown/MCP tools remain unknown. Normalize only documented fields.
   Filter candidates for context + output reserve, tools, modality, structured output and
   supported effort before cost comparison. Advertise conservative alias capabilities.
2. **OpenCode reference pilot.** Validate its config against the installed CLI, then run the
   real client against a mock upstream with synthetic files and restrictive permissions.
   Keep plugins off for the first pilot. Deliver an opt-in config example and rollback.
3. **Hermes, Prime and both Kilo surfaces.** Reuse the same contract fixture suite; verify
   each client's wire selection, capability metadata and retry behavior independently.
   Add config recipes first, not empty adapter packages. Inventory main, child, title,
   compaction and refinement calls; label anything outside coverage. A protocol mismatch
   blocks that client. Do not patch internals or infer support from one text request.
4. **Native integration when useful.** Probe Hermes middleware and Prime hooks in shadow mode.
   Prove first/continuing turns, model+effort application, resume, pinning and cancellation.
   Native Python clients must not gain a second policy implementation; keep the proxy if
   no small supported bridge exists. Do not add a decision API until that need is proven.
5. **Release per tested surface/version.** Run `npm test`, `npm run typecheck` and `npm run eval`
   after implementation, then approve bounded paid smoke tests separately. Record source-reviewed,
   protocol-tested and live-smoked status separately. Cost/quality claims require fixed eligible
   baselines on completed tasks, counting router, judge, retry and review overhead.

## Non-negotiable contract checks

- SSE/nonstream, fragmented and parallel tool calls, usage, alias consistency, 4xx/5xx,
  rate limits, cancellation and disconnects; no duplicate tool execution or partial replay.
- Unknown price/usage is not zero. Separate requested/observed model and verified/unknown
  outcomes. Keep Jev off during transport pilots; enabling it needs separate data/budget scope.
- Add explicit opaque host/session/round/request attribution where supported; strip routing
  metadata before upstream forwarding. It conveys identity, not permissions. Without stable
  IDs, stay stateless and label grouping unknown; do not merge sessions by shared prompts.
- One retry owner per boundary, bounded total attempts/deadline; host denial and cancellation
  stop work. Do not turn authentication failures or a 429 into “use a smarter model.”
- Preserve the host's compaction and user model pin. Test model switches with tool history,
  reasoning fields and images; pin a compatible backend or fail clearly if switching is unsafe.
- Loopback in the same network namespace only for the first release. Containers/remote hosts
  need an explicit authenticated private connection design, not an incidental `0.0.0.0` bind.
- Opt-in only: isolated config/profile, no default-provider changes or secret migration.
  Rollback selects the original provider and disables the Sabi profile; no file deletion.

## Work boundaries and approval

Implementation targets: existing `packages/core/src/{types,state,policy,router,harness,log}.ts`,
`packages/server/src/{server,upstream,sse}.ts` and their tests, only where fixtures show gaps.
Extend `packages/evals`; do not treat frozen/simulated outcomes as live performance evidence.
Create native adapter packages only after a supported hook passes its contract test.

Approve this sequence before implementation. Live calls, credentials, installed-client
changes and any upstream contribution/publication require separate approval. Release order:
shared contract → OpenCode → remaining clients in parallel → optional native adapters.
