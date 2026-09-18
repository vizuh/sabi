# Decisions Log

Record only meaningful decisions: what, why, tradeoffs, what to revisit. Template: `www/_shared/templates/workflow/docs/decisions.md`.

---

## [2026-09-18] Product name and namespace: Sabi under vizuh/sabi

### Decision
Product name is **Sabi**; the repository lives at `github.com/vizuh/sabi` (private).

### Why
`sabi`, `uasabi` and `sabido` GitHub handles are taken; Sabido is already the name of the separate Vizuh learning product. Keeping the brand short and hosting it under the existing Vizuh namespace beats weakening the name to fit a handle.

### Alternatives considered
- Rename the product to fit an available handle — rejected; the name is the brand.
- Wait for a dedicated org handle — blocked; candidate handles are taken.

### Tradeoffs
- Repo owner reads "vizuh", not "sabi"; a later move to a dedicated org changes the URL.
- Two similarly named products (Sabi, Sabido) coexist — docs must disambiguate explicitly.

### Revisit later?
Only if the project outgrows the Vizuh namespace and a clean org handle becomes available.

---

## [2026-09-18] One monorepo with four package groups

### Decision
Single repository (`vizuh/sabi`) with planned `packages/core`, `packages/judges/jev`, `packages/evals` and `packages/adapters/{command-code,prime-agent,opencode}` — not six separate repos.

### Why
Adapters depend on a shared core contract that is still moving; one integration surface beats cross-repo versioning during the design phase.

### Alternatives considered
- Repo per component (core, each adapter, judges, evals) — rejected as premature packaging infrastructure.

### Tradeoffs
- Coarser release cadence; package boundaries must be maintained by discipline.
- A single CI surface for unrelated components.

### Revisit later?
When one adapter needs an independent release cadence or external consumers pin `core`.

---

## [2026-09-18] Docs-first bootstrap; no code scaffold

### Decision
The bootstrap ships documentation and research only (README, AGENTS/CLAUDE, context/decisions/handoff, prior-art survey). No package manifests or source scaffolding.

### Why
No component contract exists yet; empty package scaffolding would be speculative. Workspace bootstrap convention (`www/_shared/templates/workflow/bootstrap-checklist.md`) defines bootstrap as docs + registration.

### Alternatives considered
- Scaffold the TypeScript monorepo now — rejected; the stack choice was not yet a real decision.

### Revisit later?
At the first implementation task: scaffold `packages/core` with the routing-contract types, then the first adapter.
