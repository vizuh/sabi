# Implementation Plan: Harness Identity and Dispatch Safety

**Branch**: 014-harness-identity-and-dispatch-safety | **Date**: 2026-09-25 |
**Spec**: [spec.md](./spec.md)

## Summary

Make "what harnesses exist" a single fact, and make "I do not recognise this
host" a refusal rather than a default. The current failure mode is a harness
that is half-installed and looks fine, because dispatch falls through to a
known host instead of refusing.

Three steps in order: one declaration, explicit dispatch, then the contract
decision. The first two are mechanical and independently shippable; the third
is a judgement call recorded rather than smuggled.

## Technical Context

TypeScript 5.9, Node ≥22.6. No new runtime dependency. The work is removal:
five lists become one, two fall-through branches become refusals.

**Working-tree note.** `packages/controller/src/inventory.ts`, `orca.ts` and
`runtime.ts` carry uncommitted performance budgeting (session-enrichment and
catalog-probe time budgets, measured live 2026-09-25). Those edits overlap the
functions this spec touches, and `inventory.ts` additionally has a
`console.time('DIAG2 orcaQueries')` diagnostic left in a production path. Reconcile
before editing either file; do not discard that work. The diagnostic is not a
user story here but should be removed before merge.

## Constitution Check

- **Native Harness, Bounded Scheduler** — PASS. Dispatch and install are exactly
  the surface where "bounded by explicit capability, provider and retry
  constraints" is decided; making the boundary explicit is this spec's whole
  purpose.
- **Evidence Before Adaptation** — PASS. A silently-defaulted host is an
  unverified fact treated as observed. Refusing is the evidence-preserving
  choice.
- **Deterministic Safety Gates** — PASS, and improved. An unsupported host is
  now a deterministic refusal with a named reason rather than a branch
  coincidence.
- **Testable Contracts and Receipts** — PASS, and this spec is where it was
  weakest. The existing contract is typed but unconsulted; making it honest is a
  direct application.
- **Privacy, Simplicity, Reversibility** — PASS. Net deletion. Each step can
  ship alone and be reverted alone.

## Project Structure

```text
packages/controller/src/
├── adapter-contract.ts    # the declaration; becomes authoritative or labelled
├── harness-registry.ts     # NEW: the single derived registry
├── inventory.ts            # DEFAULT_HARNESSES derives from the registry
├── hooks.ts                # if-chain becomes a keyed dispatch
└── host-install.ts         # trailing `else` becomes an explicit refusal
packages/core/src/
├── types.ts                # AdapterKind reconciled with the controller id
├── manifest.ts             # orphaned loader resolved
└── adapter-emitter.ts      # ADAPTER_IDS reconciled
packages/server/src/
└── server.ts               # CLIENTS reconciled
```

## Design Decisions

### One declaration, derived everywhere

`HarnessAdapterManifest` already declares what a harness is: id, display name,
command, status, consent, and per-operation modes. It is the natural single
source — it simply is not consulted. Making it authoritative is both less work
and less invention than adding a fifth registry.

The five sites become: `DEFAULT_HARNESSES` derives, the `cli.ts` filters derive,
and `controller.ts`'s allowlist derives. The two `InstallableHost`/`SabiHost`
unions collapse into the declaration's `operations` record, which already
distinguishes a host you can install into from one you can only inventory.

### The conflict is resolved in favour of the declaration, and recorded

The three-harness set and the eight-harness set disagree today. Rather than
pick silently, the resolution is written in-file: the declaration's `status`
field is the tiebreaker. `cli.ts` wanted hook-installable hosts;
`controller.ts` wanted the broader orchestration set. Those are different
questions, and the declaration can answer both — `status` and `operations`
together, rather than two hand-maintained lists answering them separately.

`'grok'` appears only in `controller.ts:566` and nowhere else. It is not a
harness in any manifest, directory or client list. It must be either declared or
removed, and that decision is recorded rather than inferred.

### Unknown host refuses; it does not default

`installHooks` treating every unrecognised host as OpenCode, and `declaredPath`
treating it as Orca, are the two places where a bug becomes invisible. Both
become explicit refusals naming the host. This is the highest-value change in the
spec and the smallest diff.

A registry keyed by host is the structural form: the set of hosts with real
install logic is then enumerable, which is what makes the CI check possible.

### The contract decision is a decision, not a refactor

Two acceptable end states, and the spec refuses to leave the current one:

1. The manifest is consulted by dispatch. Then a harness added through the
   manifest changes observable behaviour, proven by a test.
2. The manifest is marked aspirational in the file header, and the orphaned
   `opencode/adapter.json` is either loaded or deleted along with the
   uncalled loader.

A typed contract that looks enforced and is not is worse than no contract,
because it invites a contributor to build on it. Whichever is chosen, the file
header must match reality and a test must prove which state it is in.

### The ternary becomes a declared field

`agent === 'opencode' ? ['models'] : ['--list-models']` assumes every other
harness speaks `--list-models`, unchecked. That becomes a declared discovery
command, and a harness without one is not probed — the same conservative rule
the code already applies to `preferredModels`.

## Phase Order

1. **Explicit dispatch** — smallest diff, highest value, independently safe.
2. **One declaration** — derive the five sites; resolve the conflict on record.
3. **Contract decision** — enforce or label; resolve the orphan.
4. **Protocol data** — the discovery command becomes a field.

Phase 1 first because it is the one that can silently produce a broken
install today. Phases 2 and 3 interact and should be reviewed together.

## Verification Strategy

- Every "still installs" claim is proven by comparing the written file against a
  pre-change fixture, not by asserting a return value. A registry refactor that
  changes a config file's shape is invisible to a status-code assertion.
- Every "no longer defaults" claim is proven by passing an unknown host and
  asserting no file was written anywhere.
- The declaration-to-dispatch completeness check is a test, so the fifth list
  cannot grow back.
- The contract state is proven by a test that fails if the file header and the
  code disagree.
