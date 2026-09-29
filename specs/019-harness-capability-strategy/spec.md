# Feature Specification: Harness Capability Strategy

**Feature Branch**: `spec/harness-capability-strategy`
**Created**: 2026-09-29
**Status**: Draft

**Input**: One question, asked for every harness Sabi attaches to: *given a
requested operation, which strategies can Sabi legally perform here?* Sabi
adapts its level of control to the harness. It does not assume a common harness
abstraction.

**Relationship to existing work**

- **Adapter contract v1** (`packages/controller/src/adapter-contract.ts`)
  declares seven operations per harness (`detect`, `install`,
  `identify-session`, `receive-prompt`, `dispatch`, `observe-outcome`,
  `uninstall`), each `native` | `hook` | `cli` | `missing`, plus a status.
- **Spec 017** proposes model-selection fields per adapter
  (`canApplyRecommendation`, `selectionScope`, `reportsCatalog`), default
  "cannot" until proven. They exist in the spec and tasks only; no adapter
  exports them yet.
- **Spec 018** is the first consumer: its preparer and executor roles are
  chosen from these capabilities, not from harness names.
- **Spec 016** is how a decision travels to a host ("Sabi recommends, host
  applies"). This spec decides which decisions are legal to send.

This spec does not introduce new orchestration, new vocabulary for tasks or
handoffs, or any capability that has not been declared or probed.

---

## Problem

Capability knowledge is split and incomplete:

- Two partial declarations: operations in the adapter contract, model
  selection in spec 017. Nothing joins them.
- Hermes and OMP, the two harnesses whose every inference round already passes
  through Sabi's proxy, have **no adapter manifest at all**. The controller
  only lists them as inventory commands (`packages/controller/src/inventory.ts`).
- What has been learned by probing lives in prose: OMP's extension surface
  (spec 017, OMP 18.4.1), OMP's RPC mode (`docs/decisions.md`, 2026-09-28),
  Claude's 10-second hook budget (`HOOK_TIMEOUT_SECONDS`,
  `packages/controller/src/hooks.ts`). Code cannot consult prose.

Without one answer, strategy logic drifts toward `if (harness === 'claude')`
branches, and a capability claimed for one host quietly gets assumed for
another.

## Design

### A. Effective capabilities: one record per harness, with provenance

```ts
type Provenance =
  | { kind: 'declared'; source: string }                 // adapter contract or 017 field
  | { kind: 'probed'; source: string; version: string; observedAt: string }
  | { kind: 'runtime'; observedAt: string }              // seen live this session

interface Capability<T> { value: T; provenance: Provenance }

interface EffectiveHarnessCapabilities {
  harness: string

  // from the adapter contract
  observePrompt: Capability<boolean>        // receive-prompt != missing
  identifySession: Capability<boolean>
  dispatch: Capability<'hook' | 'cli' | 'native' | 'none'>
  observeOutcome: Capability<boolean>

  // from spec 017
  applyModelRecommendation: Capability<boolean>
  selectionScope: Capability<'turn' | 'session' | 'none'>
  reportsCatalog: Capability<boolean>

  // new, each needing a declaration or a probe
  routeInference: Capability<boolean>       // its rounds pass through Sabi's proxy
  injectPromptContext: Capability<boolean>  // a hook can attach context to a prompt
  hookBudgetMs: Capability<number | null>
  scriptedSession: Capability<boolean>      // start and drive a run without a human
  registerTool: Capability<boolean>
  spawnWorker: Capability<boolean>
  observeUsage: Capability<boolean>         // token use visible to Sabi
  checkpoint: Capability<boolean>
}
```

A field with no declaration and no probe is **absent**, and absent means
unavailable. There is no global default, and no field is inferred from
another harness.

### B. What is established today

Only cited facts. Everything else is absent.

| Capability | Claude Code | Codex | Hermes | OMP |
|---|---|---|---|---|
| observePrompt | hook (contract) | hook (contract) | absent | absent |
| dispatch | cli (contract) | cli (contract) | absent | RPC `prompt` accepted (probed, 2026-09-28) |
| observeOutcome | cli (contract) | cli (contract) | absent | absent |
| routeInference | no on current wiring (`sabi doctor`, 2026-09-28) | absent | yes, `llm_request` middleware (`docs/adapters/hermes.md`) | yes, `sabi/sabi-code` provider (`docs/adapters/oh-my-pi.md`) |
| injectPromptContext | no: Sabi's Claude hook returns no `additionalContext` (`hooks.ts`) | yes: Codex hook output carries `additionalContext` (`hooks.ts`) | absent | absent |
| hookBudgetMs | 10 000 (`HOOK_TIMEOUT_SECONDS`) | absent | n/a | n/a |
| selectionScope | absent | absent | absent | `session` via extension (spec 017 probe) |
| reportsCatalog | absent | absent | absent | no via extension (spec 017 probe) |
| registerTool | absent | absent | absent | yes via extension (spec 017 probe) |
| scriptedSession | `claude -p` (CLI reference, 2026-09-28) | absent | absent | RPC mode (probed); `set_model` field unpinned |

Where a cell cites a document rather than a probe of this installation, the
provenance records it as `declared`, not `probed`.

### C. Strategy selection

A strategy names the capabilities it requires. Control picks the first
strategy, in a fixed preference order, whose requirements are all established;
if none is, it refuses with the missing capability named, which becomes an
`ASK` or `unknown` decision, never a silent fallback.

Example, from spec 018:

| Role | Strategy | Requires |
|---|---|---|
| Preparer | harness-run preparation on free models | `routeInference`, and `scriptedSession` or `dispatch` |
| Executor | fresh session from a brief | `dispatch` |
| In-session offer | recommend a brief for the next handoff | `observePrompt`; runs within `hookBudgetMs` |

With the table above, Claude Code qualifies as executor and for the in-session
offer, not as preparer; Hermes and OMP qualify as preparers once their
`scriptedSession` or `dispatch` is declared or probed.

## Requirements

- **FR-001**: One function returns `EffectiveHarnessCapabilities` per harness,
  built from the adapter contract, the 017 fields, and recorded probes.
- **FR-002**: Every capability carries provenance. A `probed` capability
  records the harness version and time; a probe against a different version
  does not count until re-run.
- **FR-003**: Absent capabilities are unavailable. No capability is copied
  from one harness to another.
- **FR-004**: Strategy code reads capabilities, never harness identifiers.
  A test fails if a strategy branches on a harness name.
- **FR-005**: When no strategy qualifies, the decision names the missing
  capability.
- **FR-006**: Hermes and OMP get adapter manifests under the existing
  contract, marking unknown operations `missing`.
- **FR-007**: Probe results live as data (for example
  `packages/controller/src/probes/<harness>.json`), not only in prose, and
  cite the doc or decision that records them.

## Success Criteria

- **SC-001**: Spec 018's role assignment runs through this function with no
  harness-name branch.
- **SC-002**: Every non-absent cell in Design §B is reproduced by the function
  with its provenance.
- **SC-003**: Adding a harness requires a manifest and, optionally, probe data;
  no strategy code changes.

## Order

Spec 018 ships first and proves the Claude path with evidence. This spec
formalises why different harnesses get different strategies. Richer
orchestration comes only from capabilities proven here.

## Out of Scope

- New task, handoff or authority vocabulary.
- Orchestration features (task graphs, bounded worker fleets) on any harness.
- Probing harnesses; this spec defines where probe results go, and each probe
  is its own task.

## Open Questions

- Should `Capability` carry an expiry, so probes re-run on harness upgrades?
- Does `routeInference` depend on per-user wiring (Claude's borrowed route),
  making it a runtime capability rather than a declared one?
- OpenCode: its plugin surface (`chat.message` → `/plan` → `/route`) differs
  from both Hermes and OMP; map it in the first implementation slice.
