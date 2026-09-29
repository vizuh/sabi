# Feature Specification: Host Selection Seams (probe plan)

**Feature Branch**: `spec/routing-evidence`
**Created**: 2026-09-29
**Status**: Probe plan. No adapter code until a probe establishes the seam.
**Issues**: #159 (OpenCode Go), #160 (Gentle Pi). Follows spec 017 (native model selection) and spec 019 (capability strategy).

**Input**: two hosts are asking for the seam Sabi needs, inside the user's own
entitlement:

- anomalyco/opencode#51362 (opened 2026-09-25): one `opencode/auto` entry
  choosing among Go-eligible models **per request**.
- Gentleman-Programming/gentle-shell#1025 (opened 2026-09-14): launch-local
  routing classes (economy / balanced / quality / critical) without mutating
  global profiles.

Sabi commented on both on 2026-09-29 (disclosed). Neither seam exists yet.

---

## Principle

The host keeps its loop, its credential and its entitlement. Sabi returns a
decision; the host applies it (spec 016, as summarised in spec 019).
Proxying paid API calls through Sabi's own upstreams is **not** using the
user's subscription and must never be described as such.

## Probes

Each probe records data under `packages/controller/src/probes/` with host
version and date (spec 019 format). A capability stays "cannot" until a probe
shows it.

### OpenCode Go (#159)

| Question | Pass condition |
|---|---|
| Per-request seam | a plugin hook or provider resolver sees the request and recent turns and returns the model for this request, while OpenCode sends it with the Go credential |
| Entitlement list | OpenCode can report the models the Go plan includes, distinct from the catalogue |
| Effective model | the response or session record names the model that served (spec 021) |

Unverified lead: probes on 2026-09-28 found OMP's "openrouter" models served
via `opencode.ai`. Not evidence about OpenCode itself.

If all pass: a thin adapter mapping Sabi's decision to that seam
(`canApplyRecommendation: true`, `selectionScope: 'turn'`). If the seam
lands only as a fixed built-in rule: no adapter; note it on #51362.

### Gentle Pi (#160)

| Question | Pass condition |
|---|---|
| Typed override | a launch accepts `{ class }` or `{ model, provider?, thinking }` without touching `models.json`, profiles or frontmatter |
| Isolation | concurrent launches do not see each other's override |
| Record | the child session records the resolved class and model |

If all pass: a compatibility example that maps Sabi's decision to the launch
override (spec 017's `selectionScope` is `'turn' | 'session'`; a launch override maps to `'session'`). Launch-level complements per-round
routing; it does not replace it.

## Acceptance

- One probe file per host with version, date and pass/fail per row.
- Adapter manifests change only for rows that passed.
- Issues #159 and #160 updated with the probe result.

## Trigger

Nothing to build until the upstream issue ships something testable. Re-check
both issues when an OpenCode or Gentle Pi release notes mention them.
