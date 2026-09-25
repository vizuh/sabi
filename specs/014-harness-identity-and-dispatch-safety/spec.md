# Feature Specification: Harness Identity and Dispatch Safety

**Feature Branch**: `014-harness-identity-and-dispatch-safety`

**Created**: 2026-09-25

**Status**: Planned

**Input**: Architecture audit of the harness/adapter boundary. Four disjoint
adapter-identity taxonomies exist, they already disagree, and the declared
adapter contract is not enforced by any code path. The dispatch fall-through
defaults an unrecognized host to OpenCode, and `host-install` defaults it to
Orca. The practical failure is a harness that is silently half-installed.

**Relationship to 013/015**: 013 is the evidence plane. 015 is the duplicated
agent ranking, which is a separate behavioural bug in different files. This
spec is identity and dispatch only.

**Not in this spec**: the duplicated ranking (015), and the fact that the
controller has no non-Orca execution path, which is a larger architectural
question scoped separately.

## Context: what already exists

- `HarnessAdapterManifest` (`packages/controller/src/adapter-contract.ts:19-26`)
  is a typed, runtime-validated declaration of a harness: `id`, `status`,
  `consent`, and a complete `operations` record over seven operations.
- `AdapterKind` (`packages/core/src/types.ts:677-701`) is a second, unrelated
  10-value identity union.
- `ADAPTER_IDS` (`packages/core/src/adapter-emitter.ts:4-14`) is a third list.
- `CLIENTS` (`packages/server/src/server.ts:302`) is a fourth, enforced at
  runtime against the `x-sabi-client` header.
- `DEFAULT_HARNESSES` (`packages/controller/src/inventory.ts:47-55`) is a fifth.
- `InstallableHost` / `SabiHost` (`hooks.ts:16`, `host-install.ts:29`) are two
  more closed unions delimiting installable hosts, and they disagree: `orca` is
  a `SabiHost` but not an `InstallableHost`, while `claude` and `codex` are
  neither.

### The confirmed findings

1. **The contract is dead.** Nothing reads `HarnessAdapterManifest.operations`,
   `.status` or `.consent` for behaviour. `adapterReady` is `false` for all ten
   built-ins (asserted at `packages/controller/test/adapter-contract.test.ts:13`)
   and its only caller is a report field. `validateAdapterManifest` is only ever
   fed the literals declared beside it.
2. **`packages/adapters/opencode/adapter.json` is orphaned.** It is a valid
   protocol-2 manifest; `loadAdapterManifest` is called only from its own test.
3. **The supported-harness list is duplicated five times** in two incompatible
   forms: an inline triple-condition repeated at `cli.ts:222, 516, 591, 640`, and
   a different allowlist at `controller.ts:566` that additionally accepts
   `'grok'`, which appears nowhere else in the repository.
4. **Dispatch falls through to a default host.** `installHooks`
   (`hooks.ts:316-326`) tests `claude`, `codex`, `oh-my-pi`, `command-code` and
   then treats everything else as OpenCode. `declaredPath`
   (`host-install.ts:76-83`) ends in `else return stringAt(record.orca, ...)`.
5. **A model-list protocol difference is an unlabelled ternary.**
   `inventory.ts:140` — `agent === 'opencode' ? ['models'] : ['--list-models']`.
   Every other harness is assumed to speak `--list-models`, unchecked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One harness has one identity (Priority: P1)

As a maintainer adding a harness, I need there to be exactly one place that
declares it, so that I cannot add it in one list and miss another.

#### Acceptance Criteria

1. **Exactly one declaration.** A harness id MUST be declared in exactly one
   place. Adding a harness MUST NOT require editing a second list.
2. **Every existing list is derived or deleted.** The five sites named above
   MUST be either computed from that declaration or removed.
3. **The derived lists agree today.** The current disagreement between
   `cli.ts`'s three-harness set and `controller.ts`'s eight-harness set MUST be
   resolved deliberately, and the resolution MUST be recorded in-file with a
   reason.
4. **A harness id is a single spelling.** `'claude'` and `'claude-code'` MUST
   not both exist. If a rename is required, exactly one spelling survives and
   the old one is rejected at runtime with a migration note.
5. **A test fails when a declared harness is not handled by dispatch.**
   Declaring a harness MUST fail CI until a dispatch entry exists for it.

#### Testing

- A test enumerating declared harnesses and asserting each has a dispatch entry.
- A test asserting the two former CLI filter sites and the controller
  allowlist produce identical sets.
- A test asserting a renamed id is rejected rather than silently aliased.

### User Story 2 — An unknown host fails loudly (Priority: P1)

As an operator, I need an unrecognized host to be refused rather than
silently treated as OpenCode or Orca, so that a half-install is impossible to
mistake for a working one.

#### Acceptance Criteria

1. **No default-to-OpenCode.** `installHooks` MUST dispatch through a registry
   keyed by host, and an unrecognised host MUST produce an explicit
   `unsupported-host` result naming the host.
2. **No default-to-Orca.** `declaredPath` MUST NOT have a trailing `else` that
   resolves an unknown host as Orca. An unknown host MUST return `undefined` and
   surface as a distinct outcome.
3. **Dispatch is a registry, not a fall-through.** The set of hosts with real
   install logic MUST be enumerable from one declaration rather than inferred
   from the order of `if` branches.
4. **The failure is actionable.** The refusal MUST name the host and say which
   hosts are supported, so the operator is not left guessing.
5. **Existing supported hosts are unaffected.** Every host that installs today
   MUST still install, with identical resulting files.

#### Testing

- A test asserting an unknown host returns `unsupported-host` and that no file
  was written.
- A test asserting every currently supported host still installs, comparing the
  written file against the pre-change fixture.
- A test asserting no function in `hooks.ts` or `host-install.ts` resolves an
  unknown host to a known one.

### User Story 3 — The contract is either enforced or honestly labelled
(Priority: P1)

As a contributor, I need the adapter contract to tell the truth, so that I do
not build against a declaration that nothing reads.

#### Acceptance Criteria

1. **A decision is recorded.** Either the manifest becomes the source consulted
   by dispatch, or it is marked explicitly aspirational in the file header with
   a pointer to what *is* authoritative. The current state — a typed contract
   that looks enforced and is not — is not an acceptable end state.
2. **If made authoritative, a real code path must consult it.** Adding a
   harness via the manifest MUST change observable behaviour, demonstrated by a
   test.
3. **If marked aspirational, the orphaned manifest is addressed.**
   `packages/adapters/opencode/adapter.json` MUST be either loaded by the loader
   or removed, and the loader MUST have a production caller or be removed.
4. **The claim in the file header matches reality.** No document may state the
   contract is enforced unless a test proves it.

#### Testing

- If authoritative: a test declaring a harness through the manifest and
  observing it appear in the integrations report AND in dispatch.
- If aspirational: a test asserting `loadAdapterManifest` has production
  callers, or that it is unreferenced and marked so.

### User Story 4 — Protocol differences are data, not ternaries (Priority: P2)

As a maintainer, I need a harness's model-discovery command declared where I
can see it, not inferred from a ternary that assumes every other harness
behaves the same.

#### Acceptance Criteria

1. **The model-list command is declared per harness.** The `opencode` /
   `--list-models` distinction MUST be a declared field, not a branch.
2. **A harness with no declaration is not probed by default.** Probing an
   unknown harness risks a misparse; the current code already declines to probe
   unverified harnesses for `preferredModels` and the same rule should govern
   the command.
3. **The opencode and command-code context-window deviations remain explicit.**
   They are documented deliberate narrowings; that documentation must stay
   attached to the code that deviates.

#### Testing

- A test asserting each probed harness declares its discovery command.
- A test asserting an undeclared harness is skipped rather than guessed at.

## Requirements

### R1 — Single declaration

One declaration of harness identity. Every other list MUST be derived from it
or deleted. A harness added to the declaration and not handled by dispatch MUST
fail CI.

### R2 — Explicit dispatch

Dispatch MUST be a registry keyed by host. An unrecognised host MUST be refused
with the host named. No fall-through to a default host in any dispatch path.

### R3 — Truthful contract

The adapter contract MUST either be consulted by a production code path or be
marked aspirational in the file. The two states are the only acceptable ones.

### R4 — Declared protocol differences

Any behavioural difference between harnesses that is currently a hardcoded
branch and is not inherently tied to installing into that host's config file
MUST be expressed as declared data.

## Out of Scope

- **The duplicated agent ranking.** That is 015.
- **The absence of a non-Orca execution path.** Every `executeSelection` arm
  calls the Orca CLI, and `spawnCandidates` is emptied when Orca is absent, so
  there is no seam at which an adapter executes without Orca. This is a larger
  architectural decision and is deliberately not bundled here.
- **Making `claude` and `codex` proxy clients.** They are hook-installed and
  absent from `server.ts` `CLIENTS` today. Adding them is a product decision,
  not a safety fix.
- **Performance budgeting of Orca queries.** In flight in the working tree; see
  the note in the plan.

## Success Criteria

- [ ] Exactly one place declares a harness id.
- [ ] The five duplicated sites are gone.
- [ ] No dispatch path resolves an unknown host to a known one.
- [ ] Every currently supported host installs identically, proven by fixture
      comparison.
- [ ] The adapter contract is either enforced by a production path or explicitly
      labelled aspirational, with a test proving which.
- [ ] The orphaned `adapter.json` is either loaded or removed.
- [ ] Declaring a harness without a dispatch entry fails CI.
