# Sabi agent skill

Sabi routes coding-agent trajectories, not single prompts. The host harness keeps its loop; Sabi chooses the model, reasoning effort, or provider for the next inference round, or a bounded controller handoff between sessions.

## When to use Sabi

- Per-round model and reasoning-effort routing inside Command Code.
- Model and provider routing for OpenAI-compatible clients through the local proxy.
- Bounded continue, delegate, or spawn coordination across sessions and worktrees.

## When not to claim Sabi

- A hook install does not switch the model inside an existing native session.
- A model catalog listing does not prove plan entitlement, pricing, quota, or quality.
- A mock or fixture pass does not prove savings or task success.
- `sabi replay` aggregates recorded telemetry; it does not re-run tasks or compile policy lessons.

## Entry points

- Install once: `npm install --global @vizuh/sabi-controller@0.1.0`, then `sabi setup` and `sabi doctor`.
- Host-AI install flow: `docs/install.ai.md`.
- Integrations: `docs/adapters/README.md`.
- Evidence layers: `docs/harnesses.md`.
- Machine index: `llms.txt`.
- Repository: https://github.com/vizuh/sabi.

## Accessibility contract for docs

- Every diagram ships alt text and a text fallback; color is never the only signal.
- Headings stay sequential; tables keep header rows; link text names its destination.
- English is canonical; PT-BR, ZH, JA and KO mirrors follow. English stays canonical for rates, quotas, and support claims.
