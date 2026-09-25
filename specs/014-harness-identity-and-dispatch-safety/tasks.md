# Tasks: Harness Identity and Dispatch Safety

**Input**: `specs/014-harness-identity-and-dispatch-safety/spec.md`, `plan.md`
**Prerequisites**: none.

## Phase 0: Reconcile with the working tree (do this first)

- [ ] **T000** Read the uncommitted `inventory.ts` / `orca.ts` / `runtime.ts`
  changes. They add `SESSION_ENRICHMENT_BUDGET_MS` and
  `HARNESS_CATALOG_PROBE_BUDGET_MS` and reorder harness definitions by
  `preferredHarnesses`. Do not discard them.
- [ ] **T001** Remove the `console.time('DIAG2 orcaQueries')` /
  `console.timeEnd` pair left in `inventory.ts` production code, or move it
  behind an explicit diagnostic flag. It is not a user story but must not ship.
- [ ] **T002** Capture a fixture of what each currently supported host writes on
  install, before any refactor. Every later "still installs identically" claim
  is a diff against this.

## Phase 1: Explicit dispatch (smallest diff, highest value)

- [ ] **T010** Write failing tests first: an unknown host must produce
  `unsupported-host` naming the host, and must not write any file.
- [ ] **T011** Convert `installHooks` (`hooks.ts`) from an `if`-chain with an
  OpenCode fall-through to a registry keyed by host. An unrecognised host
  returns `{ harness, installed: false, reason: 'unsupported-host' }`.
- [ ] **T012** Remove the trailing `else` in `declaredPath`
  (`host-install.ts`) that resolves an unknown host as Orca. Return `undefined`
  and let the caller produce the refusal.
- [ ] **T013** Audit every other dispatch path for the same fall-through shape —
  `checkHookHealth`, `restoreHookBackups`, `hookOutput` — and convert any
  default-to-known-host branch found.
- [ ] **T014** Assert against the Phase 0 fixtures that every currently
  supported host writes an identical file.

## Phase 2: One declaration

- [ ] **T020** Decide and record which sites derive from
  `HarnessAdapterManifest` and which are deleted. The conflict between the
  three-harness `cli.ts` set and the eight-harness `controller.ts` set is
  resolved in the declaration's `status`/`operations` fields, and the resolution
  is written in-file with its reason.
- [ ] **T021** `DEFAULT_HARNESSES` (`inventory.ts`) derives from the declaration.
- [ ] **T022** The four inline filters at `cli.ts:222, 516, 591, 640` derive
  from the declaration. The triple condition is deleted, not moved.
- [ ] **T023** `controller.ts:566` derives. Record the decision on `'grok'`:
  declared or removed, with a reason. It currently exists in no manifest, no
  directory and no client list.
- [ ] **T024** Collapse `InstallableHost` / `SabiHost` / `HookHarness` into the
  declaration's operation record, resolving that `orca` is installable-as-host
  but not hook-installable while `claude`/`codex` are neither.
- [ ] **T025** Reconcile identity spelling. `AdapterKind`'s `'claude-code'` and
  the controller's `'claude'` cannot both survive; one spelling is kept and the
  other rejected at runtime with a migration note.
- [ ] **T026** Add the CI check: every declared harness MUST have a dispatch
  entry, and every dispatch entry MUST be declared. This is what stops a fifth
  list from growing back.
- [ ] **T027** Reconcile `ADAPTER_IDS` (`adapter-emitter.ts`) and server
  `CLIENTS` (`server.ts:302`) with the declaration. Note that `claude`, `codex`,
  `orca`, `omp` and `pi` are currently absent from `CLIENTS`, so those sessions
  never transact through the proxy. Record that as a product decision, not a bug
  to silently fix here.

## Phase 3: The contract decision

- [ ] **T030** Make the decision: authoritative, or explicitly aspirational.
  Write it in the `adapter-contract.ts` header either way. The current state —
  typed, validated, and consulted by nothing — is not an accepted outcome.
- [ ] **T031** If authoritative: wire dispatch to consult `operations` and
  `status`, and add a test proving a manifest-declared harness changes
  observable behaviour.
- [ ] **T032** If aspirational: resolve `packages/adapters/opencode/adapter.json`
  and `loadAdapterManifest`. Either the loader gains a production caller or both
  are removed. A protocol-2 manifest that nothing reads is a trap.
- [ ] **T033** Reconsider `adapterReady`. It is `false` for all ten built-ins and
  gates only a report field. Either give it a real meaning or remove it, so it
  stops implying a readiness signal that does not exist.
- [ ] **T034** Add a test that fails if the contract's file header and its
  actual enforcement disagree.

## Phase 4: Protocol differences as data

- [ ] **T040** Replace `inventory.ts`'s `agent === 'opencode' ? ['models'] :
  ['--list-models']` with a declared discovery command per harness.
- [ ] **T041** A harness with no declared discovery command is not probed. This
  matches the rule the code already applies to `preferredModels`.
- [ ] **T042** Keep the opencode and command-code context-window deviations
  explicit and documented where the deviation lives. They are deliberate
  narrowings, not accidents, and must not be silently unified.
- [ ] **T043** Fix the `manifest.id as 'opencode'` casts in `cli.ts` (the
  conformance path) that defeat `AdapterKind`'s closed union by asserting
  `'opencode'` for every adapter.

## Dependencies

- Phase 0 blocks everything; T002 is the evidence every later claim depends on.
- Phase 1 is independent of 2 and 3 and should ship first.
- Phases 2 and 3 interact: making the declaration authoritative is what removes
  the duplicated lists, and removing the lists is what makes the declaration
  authoritative. Review together.
- Phase 4 is independent and lowest value; do it last.

## Explicit non-goals

- The duplicated agent ranking. That is 015.
- The absence of a non-Orca execution path. Every `executeSelection` arm calls
  the Orca CLI and `spawnCandidates` empties when Orca is absent, so there is no
  seam at which an adapter executes without Orca. Deliberately not bundled.
- Making `claude` and `codex` proxy clients.
